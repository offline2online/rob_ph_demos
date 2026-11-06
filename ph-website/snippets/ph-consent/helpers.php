<?php
/**
 * PH Consent: public helpers for other snippets and theme code (global namespace on purpose).
 *   ph_consent_has( 'marketing' )                      true only when the visitor's cookie grants it
 *   ph_consent_server_event( 'linkedin', 'lead', [] )  the gate for server-side Conversions API calls
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'ph_consent_parse' ) ) {
	/** Parse a ph_consent cookie value: v=<policy>&id=<hex>&a=0|1&m=0|1&d=0|1. Null if absent, malformed or for an older policy. */
	function ph_consent_parse( $raw, $policy ) {
		if ( ! is_string( $raw ) || '' === $raw || strlen( $raw ) > 200 ) {
			return null;
		}
		parse_str( $raw, $c );
		if ( ! isset( $c['v'], $c['id'], $c['a'], $c['m'] ) || $c['v'] !== $policy || ! preg_match( '/^[a-f0-9]{16,32}$/', (string) $c['id'] ) ) {
			return null;
		}
		return [ 'id' => $c['id'], 'analytics' => '1' === $c['a'], 'marketing' => '1' === $c['m'], 'implied' => ( $c['d'] ?? '0' ) === '1' ];
	}
}

if ( ! function_exists( 'ph_consent_has' ) ) {
	function ph_consent_has( $category ) {
		if ( 'necessary' === $category ) {
			return true;
		}
		$cfg = require __DIR__ . '/config.php';
		$c   = ph_consent_parse( isset( $_COOKIE[ $cfg['cookie'] ] ) ? wp_unslash( $_COOKIE[ $cfg['cookie'] ] ) : '', $cfg['policy'] ); // phpcs:ignore WordPress.Security
		return $c && ! empty( $c[ $category ] );
	}
}

if ( ! function_exists( 'ph_consent_server_event' ) ) {
	/**
	 * Gate for server-side Conversions API calls. Returns false (and does nothing) unless marketing consent is on.
	 * Otherwise runs do_action( 'ph_consent_server_event', $network, $event, $data ): the LinkedIn / Meta integrations hook there
	 * once their ad accounts' access tokens exist. No API call is made by this snippet.
	 */
	function ph_consent_server_event( $network, $event, array $data = [] ) {
		if ( ! ph_consent_has( 'marketing' ) ) {
			return false;
		}
		do_action( 'ph_consent_server_event', $network, $event, $data );
		return true;
	}
}
