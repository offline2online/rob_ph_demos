<?php
/**
 * php ph-website/tests/tour.test.php : the telco product tour.
 * Route and headers (a child process, because the handler exits), POST ph-site/v1/tour-lead validation, free domains, test flag,
 * private ph_lead meta, the ph_lead_captured payload, the console ingest body, and the generated tour-telco.php.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063 {
	function header( $h ) { $GLOBALS['hdr'][] = $h; }
	function status_header( $c ) { $GLOBALS['status'] = $c; }
	function data( $f ) { return require __DIR__ . '/../snippets/ph-industry-enhancements/' . $f; }
}
namespace {
error_reporting( E_ALL );
define( 'ABSPATH', '/' );
define( 'HOUR_IN_SECONDS', 3600 );
$fails = 0;
function ok( $c, $m ) { global $fails; if ( ! $c ) { $fails++; fwrite( STDERR, "FAIL: $m\n" ); } }
$dir = dirname( __DIR__ ) . '/snippets/ph-industry-enhancements';

foreach ( array( '/industries/telco/tour/?embed=1', '/industries/telco/tour?embed=1', '/industries/telco/tour/' ) as $u ) {
	$out = shell_exec( 'php ' . escapeshellarg( __DIR__ . '/tour-serve.php' ) . ' ' . escapeshellarg( $u ) . ' GET' );
	$cut  = strrpos( (string) $out, "\n@@" );
	$j    = false === $cut ? null : json_decode( substr( $out, $cut + 3 ), true );
	$html = false === $cut ? '' : substr( $out, 0, $cut );
	ok( $j && 200 === $j['status'], "$u answers 200" );
	$h = $j ? implode( "\n", $j['hdr'] ) : '';
	ok( false !== strpos( $h, 'Content-Type: text/html' ), "$u is text/html" );
	ok( false !== strpos( $h, 'X-Robots-Tag: noindex' ), "$u is noindex" );
	ok( false !== strpos( $h, 'X-Frame-Options: SAMEORIGIN' ), "$u X-Frame-Options" );
	ok( false !== strpos( $h, "frame-ancestors 'self'" ), "$u CSP frame-ancestors" );
	ok( false !== strpos( $h, 'Cache-Control: public, max-age=3600' ), "$u cache" );
	ok( hash( 'sha256', $html ) === hash_file( 'sha256', $dir . '/tour/telco.html' ), "$u serves telco.html byte for byte" );
}
foreach ( array( array( '/industries/telco/', 'GET' ), array( '/industries/telco/tour/x', 'GET' ), array( '/industries/telco/tour/', 'POST' ) ) as $c ) {
	$out = shell_exec( 'php ' . escapeshellarg( __DIR__ . '/tour-serve.php' ) . ' ' . escapeshellarg( $c[0] ) . ' ' . $c[1] );
	ok( false !== strpos( (string) $out, '"fellThrough":true' ), $c[1] . ' ' . $c[0] . ' is left to WordPress' );
}
$out = shell_exec( 'php ' . escapeshellarg( __DIR__ . '/tour-serve.php' ) . ' /industries/telco/tour/ GET' );
ok( false === strpos( (string) $out, 'fellThrough' ) && 0 === ( json_decode( substr( $out, strrpos( $out, "\n@@" ) + 3 ), true )['status'] ?? 1 ) - 200, 'route exits after answering' );
preg_match( '/@@\{"fellThrough":true,"prio":(\d+)\}/', (string) shell_exec( 'php ' . escapeshellarg( __DIR__ . '/tour-serve.php' ) . ' /x/ GET' ), $pm );
ok( isset( $pm[1] ) && '0' === $pm[1], 'registered at template_redirect priority 0' );

/* generated PHP equals the repo source */
$src = file_get_contents( $dir . '/tour/telco.html' );
$php = file_get_contents( $dir . '/tour-telco.php' );
ok( hash( 'sha256', require $dir . '/tour-telco.php' ) === hash( 'sha256', $src ), 'tour-telco.php returns telco.html byte for byte (sha256)' );
ok( 0 === preg_match( '/^PHTOUR/m', $src ), 'no line of telco.html starts with PHTOUR' );
ok( 1 === preg_match_all( '/^PHTOUR/m', $php ), 'tour-telco.php has exactly one PHTOUR terminator line' );
ok( 0 === strpos( $php, "<?php return <<<'PHTOUR'\n" ), 'nowdoc, nothing interpolated' );

/* REST handler */
$GLOBALS['opts'] = array( 'admin_email' => 'a@x.test' ); $GLOBALS['tr'] = array(); $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['fired'] = array(); $GLOBALS['mails'] = array(); $GLOBALS['routes'] = array(); $GLOBALS['http'] = array();
function add_action( $n, $cb ) { if ( 'rest_api_init' === $n ) { $GLOBALS['rest'][] = $cb; } }
function add_filter() {} function register_setting() {} function add_settings_field() {} function current_user_can() { return false; }
function wp_unslash( $v ) { return $v; } function sanitize_text_field( $v ) { return trim( strip_tags( (string) $v ) ); }
function sanitize_email( $v ) { return trim( (string) $v ); } function is_email( $v ) { return (bool) filter_var( $v, FILTER_VALIDATE_EMAIL ); }
function get_transient( $k ) { return $GLOBALS['tr'][ $k ] ?? false; } function set_transient( $k, $v ) { $GLOBALS['tr'][ $k ] = $v; }
function wp_insert_post( $a ) { $GLOBALS['posts'][] = $a; return count( $GLOBALS['posts'] ); } function is_wp_error() { return false; }
function update_post_meta( $id, $k, $v ) { $GLOBALS['meta'][ $id ][ $k ] = $v; }
function do_action( $n, $p = null ) { $GLOBALS['fired'][] = array( $n, $p ); }
function wp_mail( $to, $s, $b ) { $GLOBALS['mails'][] = array( $to, $s, $b ); }
function get_option( $k, $d = false ) { return $GLOBALS['opts'][ $k ] ?? $d; }
function wp_json_encode( $v ) { return json_encode( $v ); }
function register_rest_route( $ns, $r, $a ) { $GLOBALS['routes'][ $ns . $r ] = $a; }
class WP_REST_Response { public $data; public $status; function __construct( $d, $s ) { $this->data = $d; $this->status = $s; } }
class WP_REST_Request { private $b; function __construct( $b ) { $this->b = $b; } function get_json_params() { return $this->b; } }
$GLOBALS['hdr'] = array();
require $dir . '/leads.php';
require $dir . '/tour.php';
foreach ( $GLOBALS['rest'] as $cb ) { $cb(); }
$route = $GLOBALS['routes']['ph-site/v1/tour-lead'] ?? null;
ok( $route && 'POST' === $route['methods'], 'POST ph-site/v1/tour-lead is registered' );
$n_ip = 0;
$call = function ( array $b, $ip = null ) use ( $route, &$n_ip ) { $_SERVER['REMOTE_ADDR'] = $ip ?? '10.0.0.' . ( ++$n_ip ); return $route['callback']( new WP_REST_Request( $b ) ); };
$good = array( 'name' => 'Ada Lovelace', 'company' => 'Nimbus Mobile', 'email' => 'ada@nimbus.example', 'consent' => true, 'industry' => 'telco', 'source' => 'Interactive product tour', 'flow' => 'Personalisation', 'page' => '/industries/telco/', 'test' => false );

$r = $call( array_merge( $good, array( 'website' => 'spam' ) ) );
ok( 200 === $r->status && ! $GLOBALS['posts'], 'honeypot answers ok and stores nothing' );
$r = $call( array_merge( $good, array( 'name' => '' ) ) ); ok( 400 === $r->status && 'name' === $r->data['field'], 'name required' );
$r = $call( array_merge( $good, array( 'company' => str_repeat( 'a', 121 ) ) ) ); ok( 400 === $r->status && 'company' === $r->data['field'], 'company over 120 refused' );
$r = $call( array_merge( $good, array( 'name' => str_repeat( 'a', 121 ) ) ) ); ok( 400 === $r->status && 'name' === $r->data['field'], 'name over 120 refused' );
$r = $call( array_merge( $good, array( 'email' => 'nope' ) ) ); ok( 400 === $r->status && 'email' === $r->data['field'], 'invalid email refused' );
foreach ( array( 'a@gmail.com', 'a@Outlook.com', 'a@hotmail.co.uk', 'a@yahoo.com', 'a@icloud.com', 'a@protonmail.com' ) as $e ) {
	$r = $call( array_merge( $good, array( 'email' => $e ) ) );
	ok( 400 === $r->status && 'Please use your work email.' === $r->data['error'] && 'email' === $r->data['field'], "free domain refused: $e" );
}
$r = $call( array_merge( $good, array( 'email' => 'a@gmailer.example' ) ) ); ok( 200 === $r->status, 'a work domain that merely starts like a free one passes' );
$GLOBALS['posts'] = array(); $GLOBALS['fired'] = array(); $GLOBALS['mails'] = array(); $GLOBALS['meta'] = array();
$r = $call( array_merge( $good, array( 'consent' => false ) ) ); ok( 400 === $r->status && 'consent' === $r->data['field'], 'consent required' );
ok( ! $GLOBALS['posts'] && ! $GLOBALS['fired'], 'refused requests store and fire nothing' );

$r = $call( $good );
ok( 200 === $r->status && true === $r->data['ok'], 'a good lead answers ok' );
$m = $GLOBALS['meta'][1] ?? array();
ok( 'private' === $GLOBALS['posts'][0]['post_status'] && 'ph_lead' === $GLOBALS['posts'][0]['post_type'], 'private ph_lead post' );
ok( 'interactive-product-tour' === ( $m['ph_lead_source'] ?? '' ), 'source' );
ok( 'Interactive product tour – Telco' === ( $m['ph_lead_source_label'] ?? '' ), 'source label' );
ok( 'Personalisation' === ( $m['ph_lead_tour_flow'] ?? '' ) && '/industries/telco/' === ( $m['ph_lead_page'] ?? '' ), 'demo and page meta' );
ok( 'Ada Lovelace' === $m['ph_lead_name'] && 'Nimbus Mobile' === $m['ph_lead_company'] && 'ada@nimbus.example' === $m['ph_lead_email'] && 1 === $m['ph_lead_consent'], 'name, company, email, consent meta' );
ok( ! isset( $m['ph_lead_test'] ), 'a real lead is not flagged test' );
ok( 1 === count( $GLOBALS['mails'] ) && 'a@x.test' === $GLOBALS['mails'][0][0] && false !== strpos( $GLOBALS['mails'][0][2], 'Personalisation' ), 'the admin email is sent for a real lead' );
$a = $GLOBALS['fired'][0] ?? array();
ok( 'ph_lead_captured' === $a[0], 'ph_lead_captured fires' );
$p = $a[1] ?? array();
ok( 'Interactive product tour – Telco' === $p['source_label'] && 'telco' === $p['industry'] && 'Personalisation' === $p['flow'] && false === $p['test'] && 'Personalisation' === $p['source_detail'] && 1 === $p['post_id'], 'action payload' );
$b = \AngieSnippets\PhIndustryEnhancements_10063\lead_ingest_body( $p );
ok( 'Nimbus Mobile' === $b['company'] && 'Ada Lovelace' === $b['contactName'] && 'ada@nimbus.example' === $b['email'], 'ingest body: company, contact, email' );
ok( 'Interactive product tour – Telco' === $b['sourceLabel'] && 'Personalisation' === $b['sourceDetail'] && '/industries/telco/' === $b['page'] && 'telco' === $b['pageIndustry'] && ! isset( $b['test'] ), 'ingest body: sourceLabel, sourceDetail, page, industry' );
$b2 = \AngieSnippets\PhIndustryEnhancements_10063\lead_ingest_body( array( 'company' => 'X', 'email' => 'x@y.example', 'name' => 'X' ) );
ok( ! isset( $b2['sourceLabel'] ) && ! isset( $b2['sourceDetail'] ), 'sourceLabel and sourceDetail are only sent when present' );

$GLOBALS['mails'] = array(); $GLOBALS['fired'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['posts'] = array();
$r = $call( array_merge( $good, array( 'test' => true ) ), '2.2.2.2' );
ok( 200 === $r->status && '1' === ( $GLOBALS['meta'][1]['ph_lead_test'] ?? '' ), 'test lead is flagged ph_lead_test' );
ok( ! $GLOBALS['mails'], 'test lead sends no admin email' );
ok( true === $GLOBALS['fired'][0][1]['test'] && true === \AngieSnippets\PhIndustryEnhancements_10063\lead_ingest_body( $GLOBALS['fired'][0][1] )['test'], 'test flag reaches the action and the ingest body' );
$r = $call( array_merge( $good, array( 'test' => 'true', 'flow' => 'Something else' ) ), '3.3.3.3' );
ok( '' === $GLOBALS['meta'][2]['ph_lead_tour_flow'] && '1' === $GLOBALS['meta'][2]['ph_lead_test'], 'string "true" is a test; an unknown demo name is not stored' );
foreach ( array( 'Campaign creation', 'Localisation & scheduling' ) as $fl ) {
	$call( array_merge( $good, array( 'flow' => $fl ) ), '4.4.4.4' ); end( $GLOBALS['meta'] );
	ok( $fl === current( $GLOBALS['meta'] )['ph_lead_tour_flow'], "demo $fl stored" );
}
for ( $i = 0; $i < 12; $i++ ) { $r = $call( $good, '9.9.9.9' ); }
ok( 429 === $r->status, 'throttled after 10 per hour per address' );

/* the free-mail list is the tour's own */
preg_match( '/const FREE_MAIL = (\/.*?\/i);/', $src, $mm );
ok( ! empty( $mm[1] ) && \AngieSnippets\PhIndustryEnhancements_10063\tour_free_mail( 'x@gmail.com' ) === (bool) preg_match( $mm[1], 'x@gmail.com' ), 'FREE_MAIL found in the tour' );
preg_match( '/@\((.*?)\)\\\\\./', $mm[1] ?? '', $names ); // the alternation inside @( ... )\.
$php_re = file_get_contents( $dir . '/tour.php' );
preg_match( '/@\(([^)]*)\)\\\\\./', $php_re, $pn );
ok( ! empty( $names[1] ) && ( $names[1] ?? 'a' ) === ( $pn[1] ?? 'b' ), 'tour.php free-domain list equals the tour FREE_MAIL' );

echo $fails ? "$fails failed\n" : "tour: all passed\n"; exit( $fails ? 1 : 0 );
}
