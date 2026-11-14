<?php
/**
 * Website lead capture -> PH Agent Console Leads.
 *
 * - POST ph-site/v1/industry-lead: the lead form on the telco and retail industry pages.
 * - Every `ph_lead_captured` action (these forms and the telco business-model gate) is forwarded server-to-server to the
 *   console's leadIngest endpoint with the page and industry. The key stays on the server: define PH_LEAD_INGEST_KEY in
 *   wp-config.php or save the `ph_lead_ingest_key` option. Without it the lead is still kept as a private ph_lead post.
 * - Test mode: the browser sends test=true (the page was opened with ?ph_test=1). The console stores it as a test lead,
 *   it can be deleted from the Leads page's Test view, and no notification email is sent for it.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const LEAD_FORM_INDUSTRIES = array( 'telco', 'retail' );
const LEAD_INGEST_URL      = 'https://backlog-tracker-e4ed2.web.app/leadIngest/v1/submit';

function lead_is_test( $v ) {
	return true === $v || in_array( strtolower( trim( (string) $v ) ), array( '1', 'true', 'yes', 'on' ), true );
}

function lead_throttled() {
	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$key = 'ph_lead_rl_' . md5( $ip );
	$n   = (int) get_transient( $key );
	if ( $n >= 10 ) {
		return true;
	}
	set_transient( $key, $n + 1, HOUR_IN_SECONDS );
	return false;
}

/**
 * One ph_lead per person: finds the existing private ph_lead with this email and test flag (or 0). A repeat capture (calculator
 * download after the tour, or the reverse) then adds an activity row to it instead of a second lead; the console dedupes the same way.
 */
function lead_find_existing( $email, $test ) {
	$q = new \WP_Query( array(
		'post_type'      => 'ph_lead',
		'post_status'    => 'private',
		'posts_per_page' => 1,
		'fields'         => 'ids',
		'no_found_rows'  => true,
		'orderby'        => 'ID',
		'order'          => 'ASC',
		'meta_query'     => array_filter( array(
			array( 'key' => 'ph_lead_email', 'value' => (string) $email ),
			$test ? array( 'key' => 'ph_lead_test', 'value' => '1' ) : array( 'key' => 'ph_lead_test', 'compare' => 'NOT EXISTS' ),
		) ),
	) );
	return empty( $q->posts ) ? 0 : (int) $q->posts[0];
}

/** Appends one activity row (source label, detail, time) to a ph_lead. */
function lead_add_activity( $id, $label, $detail = '' ) {
	$rows   = get_post_meta( (int) $id, 'ph_lead_activity', true );
	$rows   = is_array( $rows ) ? $rows : array();
	$rows[] = array( 'label' => (string) $label, 'detail' => (string) $detail, 'at' => gmdate( 'c' ) );
	update_post_meta( (int) $id, 'ph_lead_activity', array_slice( $rows, -50 ) );
}

/** Creates a private ph_lead post titled $title. Returns its id, or 0 when WordPress refuses. (The Run Your Own RMN gate's leads.) */
function lead_insert( $title ) {
	$id = wp_insert_post( array( 'post_type' => 'ph_lead', 'post_status' => 'private', 'post_title' => (string) $title ) );
	return ( $id && ! is_wp_error( $id ) ) ? (int) $id : 0;
}

/** The console body for a captured lead. Pure, so it is unit-tested. */
function lead_ingest_body( array $lead ) {
	$s    = function ( $k ) use ( $lead ) {
		return isset( $lead[ $k ] ) && is_scalar( $lead[ $k ] ) ? (string) $lead[ $k ] : '';
	};
	$page = $s( 'page' );
	$body = array(
		'company'      => $s( 'company' ),
		'website'      => $s( 'website' ),
		'industry'     => '' !== $s( 'company_industry' ) ? $s( 'company_industry' ) : $s( 'industry' ),
		'countries'    => $s( 'countries' ),
		'storeCount'   => $s( 'store_count' ),
		'contactName'  => '' !== $s( 'contact_name' ) ? $s( 'contact_name' ) : $s( 'name' ),
		'jobTitle'     => '' !== $s( 'job_title' ) ? $s( 'job_title' ) : $s( 'role' ),
		'email'        => $s( 'email' ),
		'linkedin'     => $s( 'linkedin' ),
		'page'         => $page,
		'pageIndustry' => $s( 'industry' ),
	);
	if ( '' !== $s( 'source_label' ) ) {
		$body['sourceLabel'] = $s( 'source_label' );
	}
	if ( '' !== $s( 'source_detail' ) ) {
		$body['sourceDetail'] = $s( 'source_detail' );
	}
	// Run Your Own RMN page leads (13 Nov 2026, leadType "operator"): an individual, not a company. Other pages' bodies are unchanged.
	if ( '' !== $s( 'lead_type' ) ) {
		$body['leadType'] = $s( 'lead_type' );
	}
	if ( '' !== $s( 'region' ) ) {
		$body['region'] = $s( 'region' );
	}
	if ( '' !== $s( 'background' ) ) {
		$body['background'] = $s( 'background' );
	}
	if ( ! empty( $lead['test'] ) ) {
		$body['test'] = true;
	}
	return $body;
}

function lead_forward( array $lead ) {
	$key = defined( 'PH_LEAD_INGEST_KEY' ) ? PH_LEAD_INGEST_KEY : (string) get_option( 'ph_lead_ingest_key', '' );
	if ( '' === $key ) {
		return false;
	}
	if ( empty( $lead['page'] ) ) {
		$ref          = wp_get_referer();
		$lead['page'] = $ref ? $ref : '';
	}
	$res = wp_remote_post( LEAD_INGEST_URL, array(
		'timeout' => 8,
		'headers' => array( 'Content-Type' => 'application/json', 'X-Lead-Key' => $key ),
		'body'    => wp_json_encode( lead_ingest_body( $lead ) ),
	) );
	$ok = ! is_wp_error( $res ) && in_array( (int) wp_remote_retrieve_response_code( $res ), array( 200, 201 ), true );
	if ( ! empty( $lead['post_id'] ) ) {
		update_post_meta( (int) $lead['post_id'], 'ph_lead_console', $ok ? 'sent' : 'failed' );
	}
	return $ok;
}

add_action( 'ph_lead_captured', __NAMESPACE__ . '\\lead_forward', 20 );

/** Settings -> General: a "PH lead ingest key" password field (manage_options only). The saved value is never echoed back. */
function lead_key_state() {
	if ( defined( 'PH_LEAD_INGEST_KEY' ) && '' !== PH_LEAD_INGEST_KEY ) {
		return 'set (wp-config.php)';
	}
	return '' !== (string) get_option( 'ph_lead_ingest_key', '' ) ? 'set' : 'not set';
}

/** Blank input keeps the stored key; a value replaces it. Returns the string to store. */
function lead_key_sanitize( $v ) {
	$v = is_string( $v ) ? trim( sanitize_text_field( $v ) ) : '';
	if ( '' === $v ) {
		return (string) get_option( 'ph_lead_ingest_key', '' );
	}
	return substr( $v, 0, 200 );
}

add_action( 'admin_init', function () {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	register_setting( 'general', 'ph_lead_ingest_key', array( 'type' => 'string', 'sanitize_callback' => __NAMESPACE__ . '\\lead_key_sanitize', 'default' => '', 'show_in_rest' => false ) );
	add_settings_field( 'ph_lead_ingest_key', 'PH lead ingest key', function () {
		echo '<input type="password" name="ph_lead_ingest_key" id="ph_lead_ingest_key" value="" class="regular-text" autocomplete="new-password" />';
		echo '<p class="description">Currently: <strong>' . esc_html( lead_key_state() ) . '</strong>. Paste the console lead key to set or replace it; leave blank to keep the current one.</p>';
	}, 'general' );
} );

add_action( 'rest_api_init', function () {
	register_rest_route( 'ph-site/v1', '/industry-lead', array(
		'methods'             => 'POST',
		'permission_callback' => '__return_true',
		'callback'            => function ( \WP_REST_Request $req ) {
			$b = $req->get_json_params();
			$b = is_array( $b ) ? $b : array();
			if ( ! empty( $b['hp_url'] ) ) { // honeypot: pretend success.
				return new \WP_REST_Response( array( 'ok' => true ), 200 );
			}
			if ( lead_throttled() ) {
				return new \WP_REST_Response( array( 'error' => 'Too many requests. Try again later.' ), 429 );
			}
			$industry = isset( $b['pageIndustry'] ) && is_string( $b['pageIndustry'] ) ? sanitize_key( $b['pageIndustry'] ) : '';
			if ( ! in_array( $industry, LEAD_FORM_INDUSTRIES, true ) ) {
				return new \WP_REST_Response( array( 'error' => 'Unknown page.' ), 400 );
			}
			$lead = array();
			foreach ( array( 'company', 'website', 'company_industry', 'countries', 'store_count', 'contact_name', 'job_title', 'linkedin' ) as $k ) {
				$v          = isset( $b[ $k ] ) && is_scalar( $b[ $k ] ) ? trim( sanitize_text_field( (string) $b[ $k ] ) ) : '';
				$lead[ $k ] = substr( $v, 0, 300 );
			}
			foreach ( array( 'company', 'contact_name' ) as $k ) {
				if ( '' === $lead[ $k ] ) {
					return new \WP_REST_Response( array( 'error' => 'Please complete every required field.', 'field' => $k ), 400 );
				}
			}
			$lead['email'] = isset( $b['email'] ) && is_string( $b['email'] ) ? sanitize_email( $b['email'] ) : '';
			if ( ! is_email( $lead['email'] ) ) {
				return new \WP_REST_Response( array( 'error' => 'Please enter a valid email address.', 'field' => 'email' ), 400 );
			}
			if ( empty( $b['consent'] ) ) {
				return new \WP_REST_Response( array( 'error' => 'Please tick the box to continue.', 'field' => 'consent' ), 400 );
			}
			$page = isset( $b['page'] ) && is_string( $b['page'] ) ? esc_url_raw( $b['page'] ) : '';
			$test = lead_is_test( isset( $b['test'] ) ? $b['test'] : false );
			$id   = wp_insert_post( array( 'post_type' => 'ph_lead', 'post_status' => 'private', 'post_title' => $lead['company'] . ' / ' . $lead['contact_name'] ) );
			if ( $id && ! is_wp_error( $id ) ) {
				foreach ( $lead as $k => $v ) {
					update_post_meta( $id, 'ph_lead_' . $k, $v );
				}
				update_post_meta( $id, 'ph_lead_source', 'industry-' . $industry );
				update_post_meta( $id, 'ph_lead_page', $page );
				if ( $test ) {
					update_post_meta( $id, 'ph_lead_test', '1' );
				}
			}
			do_action( 'ph_lead_captured', array_merge( $lead, array( 'source' => 'industry-' . $industry, 'industry' => $industry, 'page' => $page, 'test' => $test, 'post_id' => (int) $id ) ) );
			if ( ! $test ) {
				wp_mail( get_option( 'admin_email' ), 'New ' . $industry . ' page lead: ' . $lead['company'], "Name: {$lead['contact_name']}\nCompany: {$lead['company']}\nTitle: {$lead['job_title']}\nEmail: {$lead['email']}\nPage: $page" );
			}
			return new \WP_REST_Response( array( 'ok' => true ), 200 );
		},
	) );
} );
