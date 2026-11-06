<?php
/**
 * PH Consent: cookie consent for personalisationhub.com.
 * Google Consent Mode v2 (advanced) defaults at wp_head priority 1, a slim GOV.UK-style bottom bar (consent.js, deferred),
 * an audit log (ph-site/v1/consent, no IP), /cookie-policy/ rendered from config.php, a Cookies section on the privacy policy (7062).
 * Gating API: window.phConsent.has(), the ph:consent event, text/plain scripts with data-ph-category, ph_consent_has() (helpers.php).
 */

namespace AngieSnippets\PhConsent___ID__;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/helpers.php';

const VER        = '1.0.0';
const PRIVACY_ID = 7062;
const POLICY_URL = '/cookie-policy/';

function cfg() {
	static $c;
	return $c ? $c : ( $c = require __DIR__ . '/config.php' );
}

/** Full pages only: not the admin, REST, AJAX, feeds, the markdown twins (?format=md) or llms.txt. */
function should_load() {
	if ( is_admin() || wp_doing_ajax() || is_feed() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || isset( $_GET['format'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		return false;
	}
	return ! preg_match( '#/(llms\.txt|wp-json)(/|$)#', isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '' );
}

/** The Consent Mode default calls plus the config consent.js reads. Inline, tiny, before Site Kit's gtag. */
function head_script() {
	$c   = cfg();
	$eu  = wp_json_encode( $c['eu'] );
	$set = wp_json_encode( [ 'v' => $c['policy'], 'ck' => $c['cookie'], 'mo' => $c['months'], 'eu' => $c['eu'], 'rest' => esc_url_raw( rest_url( 'ph-site/v1/consent' ) ), 'pol' => POLICY_URL ] );
	$js  = 'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=window.gtag||gtag;'
		. 'gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",analytics_storage:"denied",region:' . $eu . ',wait_for_update:500});'
		. 'gtag("consent","default",{ad_storage:"granted",ad_user_data:"granted",ad_personalization:"granted",analytics_storage:"granted"});'
		. 'gtag("set","ads_data_redaction",true);window.phConsentCfg=' . $set . ';';
	return '<script id="ph-consent-defaults">' . $js . '</script>';
}

add_action( 'wp_head', function () {
	if ( ! should_load() ) {
		return;
	}
	echo head_script(); // phpcs:ignore WordPress.Security.EscapeOutput
	$css = (string) file_get_contents( __DIR__ . '/consent.css' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	echo '<style id="ph-consent-css">' . $css . '</style>'; // phpcs:ignore WordPress.Security.EscapeOutput
}, 1 );

add_action( 'wp_enqueue_scripts', function () {
	if ( should_load() ) {
		wp_enqueue_script( 'ph-consent-__ID__', angie_cs_get_snippet_asset_url( __FILE__, 'consent.js' ), [], VER, [ 'in_footer' => true, 'strategy' => 'defer' ] );
	}
} );

/* ---------- audit log ---------- */
function table() {
	global $wpdb;
	return $wpdb->prefix . 'ph_consent_log';
}

function install_table() {
	global $wpdb;
	if ( ! function_exists( 'dbDelta' ) ) {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	}
	dbDelta( 'CREATE TABLE ' . table() . ' (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		consent_id varchar(32) NOT NULL,
		created_at datetime NOT NULL,
		region varchar(2) NOT NULL,
		analytics tinyint(1) NOT NULL,
		marketing tinyint(1) NOT NULL,
		policy varchar(16) NOT NULL,
		action varchar(12) NOT NULL,
		PRIMARY KEY  (id),
		KEY created_at (created_at)
	) ' . $wpdb->get_charset_collate() . ';' );
}

const DB_VER = '1';

/**
 * Install on load: nothing depends on a REST call. When the autoloaded ph_consent_db option is missing or older,
 * one request takes an atomic add_option lock, creates the table (dbDelta), schedules the daily purge, records the
 * version and releases the lock. Every other request costs a single get_option. A lock older than 5 minutes is stale.
 */
function maybe_install() {
	if ( get_option( 'ph_consent_db' ) === DB_VER ) {
		return false;
	}
	if ( ! add_option( 'ph_consent_lock', time(), '', 'no' ) ) {
		if ( time() - (int) get_option( 'ph_consent_lock' ) > 300 ) {
			delete_option( 'ph_consent_lock' );
		}
		return false;
	}
	install_table();
	if ( ! wp_next_scheduled( 'ph_consent_purge' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'ph_consent_purge' );
	}
	update_option( 'ph_consent_db', DB_VER, true );
	delete_option( 'ph_consent_lock' );
	return true;
}
add_action( 'init', __NAMESPACE__ . '\\maybe_install' );
add_action( 'admin_init', __NAMESPACE__ . '\\maybe_install' );

/** Validate a log request body. Returns the row to store, or null. */
function clean_entry( $p ) {
	$c = cfg();
	if ( ! is_array( $p ) || ! isset( $p['id'] ) || ! preg_match( '/^[a-f0-9]{16,32}$/', (string) $p['id'] ) || ( $p['v'] ?? '' ) !== $c['policy'] ) {
		return null;
	}
	$region = strtoupper( (string) ( $p['region'] ?? 'XX' ) );
	$action = (string) ( $p['action'] ?? '' );
	return [
		'consent_id' => $p['id'],
		'region'     => preg_match( '/^[A-Z]{2}$/', $region ) ? $region : 'XX',
		'analytics'  => ! empty( $p['a'] ) ? 1 : 0,
		'marketing'  => ! empty( $p['m'] ) ? 1 : 0,
		'policy'     => $c['policy'],
		'action'     => in_array( $action, [ 'accept', 'reject', 'save', 'ok' ], true ) ? $action : 'save',
	];
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'ph-site/v1', '/consent', [
		'methods'             => 'POST',
		'permission_callback' => '__return_true',
		'callback'            => function ( \WP_REST_Request $req ) {
			global $wpdb;
			$row = clean_entry( $req->get_json_params() );
			if ( ! $row ) {
				return new \WP_REST_Response( [ 'ok' => false ], 400 );
			}
			// Rate limit by a salted hash of the caller; the hash lives in a 1-hour transient and is never written to the log.
			$key = 'ph_cc_rl_' . substr( wp_hash( isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : '' ), 0, 16 );
			$n   = (int) get_transient( $key );
			if ( $n >= 60 ) {
				return new \WP_REST_Response( [ 'ok' => false ], 429 );
			}
			set_transient( $key, $n + 1, HOUR_IN_SECONDS );
			$row['created_at'] = gmdate( 'Y-m-d H:i:s' );
			$ok                = $wpdb->insert( table(), $row ); // phpcs:ignore WordPress.DB
			return new \WP_REST_Response( [ 'ok' => (bool) $ok ], $ok ? 201 : 503 );
		},
	] );
	register_rest_route( 'ph-site/v1', '/consent/install', [
		'methods'             => 'POST',
		'permission_callback' => function () {
			return current_user_can( 'manage_options' );
		},
		'callback'            => function () { // harmless: the table installs itself on load, nothing depends on this route
			maybe_install();
			return [ 'ok' => true, 'table' => table(), 'version' => VER ];
		},
	] );
} );

add_action( 'ph_consent_purge', function () {
	global $wpdb;
	$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . table() . ' WHERE created_at < %s', gmdate( 'Y-m-d H:i:s', strtotime( '-' . (int) cfg()['purge'] . ' months' ) ) ) ); // phpcs:ignore WordPress.DB
} );

/* ---------- cookie policy ---------- */
function policy_html( $heading = true ) {
	$c   = cfg();
	$out = $heading ? '<h1>Cookie policy</h1>' : '';
	$out .= '<p>We use cookies and similar storage to make this site work and, only if you agree, to measure its use and our advertising. Choose in the cookie bar, or use <a href="#cookie-settings">Cookie settings</a> in the footer at any time to change your mind. Nothing other than the necessary items is set before you choose in the UK, EU/EEA and Switzerland. Policy version ' . esc_html( $c['policy'] ) . '.</p>';
	foreach ( $c['categories'] as $key => $cat ) {
		$out .= '<h2>' . esc_html( $cat['label'] ) . '</h2><p>' . esc_html( $cat['desc'] ) . '</p>';
		$rows = '';
		foreach ( $c['cookies'] as $k ) {
			if ( $k['category'] === $key ) {
				$v     = $c['vendors'][ $k['vendor'] ];
				$rows .= '<tr><td><code>' . esc_html( $k['name'] ) . '</code></td><td><a href="' . esc_url( $v['url'] ) . '" rel="noopener">' . esc_html( $v['name'] ) . '</a></td><td>' . esc_html( $k['purpose'] ) . '</td><td>' . esc_html( $k['duration'] ) . '</td></tr>';
			}
		}
		$out .= '<table><thead><tr><th scope="col">Name</th><th scope="col">Provider</th><th scope="col">Purpose</th><th scope="col">Duration</th></tr></thead><tbody>' . $rows . '</tbody></table>';
	}
	return $out . '<h2>Your choice record</h2><p>When you choose, we keep a random ID, the date, your country code, your choices and this policy version for up to ' . (int) $c['purge'] . ' months, so we can show your consent. It holds no IP address or other personal data.</p>';
}

add_action( 'template_redirect', function () {
	$path = trim( (string) wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '', PHP_URL_PATH ), '/' );
	if ( 'cookie-policy' !== $path || get_page_by_path( 'cookie-policy' ) ) { // a real page, if one is ever created, wins
		return;
	}
	status_header( 200 );
	add_filter( 'pre_get_document_title', function () {
		return 'Cookie policy | Personalisation Hub';
	} );
	get_header();
	echo '<main class="ph-cc-policy" style="max-width:860px;margin:0 auto;padding:48px 24px;overflow-x:auto">' . policy_html() . '</main>'; // phpcs:ignore WordPress.Security.EscapeOutput
	get_footer();
	exit;
} );

add_filter( 'the_content', function ( $content ) {
	if ( is_main_query() && in_the_loop() && is_page( PRIVACY_ID ) ) {
		$content .= '<h2 id="cookies">Cookies</h2><p>We use cookies and similar technologies only as set out in our <a href="' . esc_url( POLICY_URL ) . '">cookie policy</a>, which lists every cookie, who sets it and for how long. You choose which non-essential ones to allow, and can change your choice at any time with Cookie settings in the footer.</p>';
	}
	return $content;
}, 20 );
