<?php
/**
 * Telco business model: lead gate and download. The basic calculator is open; the detailed workbook is released
 * only after a lead (name, company, role, email) is captured. The lead is stored as a private ph_lead post and
 * handed to RevOps through the `ph_lead_captured` action. No names or emails go to the dataLayer.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/telco-model.php';

add_action( 'init', function () {
	register_post_type( 'ph_lead', array( 'label' => 'PH Leads', 'public' => false, 'show_ui' => true, 'show_in_rest' => false, 'supports' => array( 'title' ), 'capability_type' => 'post', 'map_meta_cap' => true, 'menu_icon' => 'dashicons-id' ) );
} );

function telco_sign( $payload, $exp ) {
	return hash_hmac( 'sha256', $exp . '|' . wp_json_encode( $payload ), wp_salt( 'auth' ) );
}

function telco_throttled() {
	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$key = 'ph_telco_rl_' . md5( $ip );
	$n   = (int) get_transient( $key );
	if ( $n >= 6 ) {
		return true;
	}
	set_transient( $key, $n + 1, HOUR_IN_SECONDS );
	return false;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'ph-site/v1', '/telco-model', array(
		'methods'             => 'POST',
		'permission_callback' => '__return_true',
		'callback'            => function ( \WP_REST_Request $req ) {
			$b = $req->get_json_params();
			$b = is_array( $b ) ? $b : array();
			if ( ! empty( $b['website'] ) ) { // honeypot: pretend success.
				return new \WP_REST_Response( array( 'ok' => true ), 200 );
			}
			if ( telco_throttled() ) {
				return new \WP_REST_Response( array( 'error' => 'Too many requests. Try again later.' ), 429 );
			}
			$lead = array();
			foreach ( array( 'name', 'company', 'role' ) as $k ) {
				$lead[ $k ] = isset( $b[ $k ] ) && is_string( $b[ $k ] ) ? trim( sanitize_text_field( $b[ $k ] ) ) : '';
				if ( '' === $lead[ $k ] || strlen( $lead[ $k ] ) > 120 ) {
					return new \WP_REST_Response( array( 'error' => 'Please complete every field.', 'field' => $k ), 400 );
				}
			}
			$lead['email'] = isset( $b['email'] ) && is_string( $b['email'] ) ? sanitize_email( $b['email'] ) : '';
			if ( ! is_email( $lead['email'] ) ) {
				return new \WP_REST_Response( array( 'error' => 'Please enter a valid email address.', 'field' => 'email' ), 400 );
			}
			if ( empty( $b['consent'] ) ) {
				return new \WP_REST_Response( array( 'error' => 'Please tick the box to continue.', 'field' => 'consent' ), 400 );
			}
			$test = ! empty( $b['test'] ) && in_array( strtolower( (string) $b['test'] ), array( '1', 'true', 'yes', 'on' ), true );
			$vals = telco_clean( isset( $b['inputs'] ) ? $b['inputs'] : array() );
			$calc = telco_calc( $vals );
			$id   = wp_insert_post( array( 'post_type' => 'ph_lead', 'post_status' => 'private', 'post_title' => $lead['company'] . ' / ' . $lead['name'] ) );
			if ( $id && ! is_wp_error( $id ) ) {
				foreach ( $lead as $k => $v ) {
					update_post_meta( $id, 'ph_lead_' . $k, $v );
				}
				update_post_meta( $id, 'ph_lead_source', 'telco-business-model' );
				if ( $test ) {
					update_post_meta( $id, 'ph_lead_test', '1' );
				}
				update_post_meta( $id, 'ph_lead_inputs', wp_json_encode( $vals ) );
				update_post_meta( $id, 'ph_lead_estimate', round( $calc['total'] ) );
			}
			do_action( 'ph_lead_captured', array_merge( $lead, array( 'source' => 'telco-business-model', 'industry' => 'telco', 'inputs' => $vals, 'estimate_3yr' => round( $calc['total'] ), 'test' => $test, 'page' => isset( $b['page'] ) && is_string( $b['page'] ) ? esc_url_raw( $b['page'] ) : '', 'post_id' => (int) $id ) ) );
			if ( ! $test ) {
				wp_mail( get_option( 'admin_email' ), 'New Telco business model lead: ' . $lead['company'], "Name: {$lead['name']}\nCompany: {$lead['company']}\nRole: {$lead['role']}\nEmail: {$lead['email']}\n3-year estimate: " . round( $calc['total'] ) . "\nInputs: " . wp_json_encode( $vals ) );
			}
			$exp = time() + DAY_IN_SECONDS;
			$url = add_query_arg( array_merge( $vals, array( 'exp' => $exp, 'sig' => telco_sign( $vals, $exp ) ) ), rest_url( 'ph-site/v1/telco-model/download' ) );
			return new \WP_REST_Response( array( 'ok' => true, 'download' => $url ), 200 );
		},
	) );
	register_rest_route( 'ph-site/v1', '/telco-model/download', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function ( \WP_REST_Request $req ) {
			$vals = telco_clean( $req->get_query_params() );
			$exp  = (int) $req->get_param( 'exp' );
			$sig  = (string) $req->get_param( 'sig' );
			if ( $exp < time() || ! hash_equals( telco_sign( $vals, $exp ), $sig ) ) {
				return new \WP_REST_Response( array( 'error' => 'This download link has expired. Please request the model again.' ), 403 );
			}
			$bytes = telco_xlsx( $vals );
			if ( '' === $bytes ) {
				return new \WP_REST_Response( array( 'error' => 'The model could not be generated.' ), 500 );
			}
			nocache_headers();
			header( 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' );
			header( 'Content-Disposition: attachment; filename="Personalisation-Hub-Telco-Business-Model.xlsx"' );
			header( 'Content-Length: ' . strlen( $bytes ) );
			echo $bytes; // phpcs:ignore WordPress.Security.EscapeOutput -- binary file.
			exit;
		},
	) );
} );
