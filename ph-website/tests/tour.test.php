<?php
/**
 * php ph-website/tests/tour.test.php : the telco and pharmacy product tour (one shared page).
 * Route and headers (a child process, because the handler exits), POST ph-site/v1/tour-lead validation, free domains, test flag,
 * private ph_lead meta, the ph_lead_captured payload, the console ingest body, and the generated tour-page.php.
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

foreach ( array( '/industries/telco/tour/?embed=1', '/industries/telco/tour?embed=1', '/industries/telco/tour/', '/industries/pharmacy/tour/?embed=1', '/industries/pharmacy/tour?embed=1', '/industries/pharmacy/tour/', '/industries/retail-media/tour/?embed=1', '/industries/retail-media/tour' ) as $u ) {
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
	ok( hash( 'sha256', $html ) === hash_file( 'sha256', $dir . '/tour/tour.html' ), "$u serves tour.html byte for byte" );
}
/* tour-page.php present: served from the file, no HTTP call (the child's wp_remote_get does not even exist there) */
/* tour-page.php absent: pinned, hash-checked copy */
$sha = hash_file( 'sha256', $dir . '/tour/tour.html' );
$serve = function ( $mode ) {
	$out = shell_exec( 'TOUR_MODE=' . $mode . ' php ' . escapeshellarg( __DIR__ . '/tour-serve.php' ) . ' /industries/telco/tour/?embed=1 GET 2>/dev/null' );
	$p1  = strrpos( (string) $out, "\n##" );
	$p2  = strrpos( (string) $out, "\n@@" );
	$aux = json_decode( substr( $out, $p1 + 3, $p2 - $p1 - 3 ), true );
	$j   = json_decode( substr( $out, $p2 + 3 ), true );
	return array( substr( $out, 0, $p1 ), $j, $aux );
};
$src_php = (string) file_get_contents( $dir . '/tour.php' );
ok( false !== strpos( $src_php, "'" . $sha . "'" ), 'TOUR_PAGE_SHA256 equals the sha256 of tour/tour.html' );
ok( 1 === preg_match( '#raw\.githubusercontent\.com/offline2online/rob_ph_demos/main/ph-website/snippets/ph-industry-enhancements/tour/tour\.html#', $src_php ), 'fetch URL follows main (the sha256 is the pin)' );
$h_telco = shell_exec( 'php ' . escapeshellarg( __DIR__ . '/tour-serve.php' ) . ' /industries/telco/tour/ GET' );
$h_pharm = shell_exec( 'php ' . escapeshellarg( __DIR__ . '/tour-serve.php' ) . ' /industries/pharmacy/tour GET' );
ok( substr( (string) $h_telco, 0, strrpos( (string) $h_telco, "\n@@" ) ) === substr( (string) $h_pharm, 0, strrpos( (string) $h_pharm, "\n@@" ) ), 'telco and pharmacy paths serve the same HTML' );
$pj = json_decode( substr( $h_pharm, strrpos( $h_pharm, "\n@@" ) + 3 ), true );
ok( 200 === $pj['status'] && false !== strpos( implode( "\n", $pj['hdr'] ), 'Cache-Control: public, max-age=3600' ) && false !== strpos( implode( "\n", $pj['hdr'] ), "frame-ancestors 'self'" ), 'pharmacy path has the same headers' );
list( $html, $j, $aux ) = $serve( 'ok' );
$out_p = shell_exec( 'TOUR_MODE=ok php ' . escapeshellarg( __DIR__ . '/tour-serve.php' ) . ' /industries/pharmacy/tour GET 2>/dev/null' );
ok( false !== strpos( (string) $out_p, '"http":1' ) && hash( 'sha256', substr( $out_p, 0, strrpos( $out_p, "\n##" ) ) ) === $sha, 'pharmacy path through the pinned fetch: same pinned HTML' );
ok( 200 === $j['status'] && hash( 'sha256', $html ) === $sha, 'absent file, correct fetch: served byte for byte' );
ok( 1 === $aux['http'] && $sha === $aux['stored'] && false === $aux['autoload'] && 10 === $aux['timeout'], 'fetched once, stored with autoload off, 10s timeout' );
ok( false !== strpos( implode( "\n", $j['hdr'] ), 'Cache-Control: public, max-age=3600' ) && false !== strpos( implode( "\n", $j['hdr'] ), 'X-Frame-Options: SAMEORIGIN' ), 'fetched page keeps the success headers' );
list( $html, $j, $aux ) = $serve( 'cached' );
ok( 200 === $j['status'] && hash( 'sha256', $html ) === $sha && 0 === $aux['http'], 'cached option with the right sha: served with no HTTP call' );
list( $html, $j, $aux ) = $serve( 'stale' );
ok( 200 === $j['status'] && 1 === $aux['http'] && $sha === $aux['stored'], 'stale sha in the option: refetched and replaced' );
foreach ( array( 'bad' => 'wrong bytes', '404' => '404' ) as $m => $label ) {
	list( $html, $j, $aux ) = $serve( $m );
	$h = implode( "\n", $j['hdr'] );
	ok( 503 === $j['status'] && false !== strpos( $h, 'Cache-Control: no-store' ) && false !== strpos( $h, 'Retry-After: 60' ) && false !== strpos( $h, 'X-Robots-Tag: noindex' ), "$label: 503 with no-store, Retry-After, noindex" );
	ok( null === $aux['stored'] && 1 === count( $aux['logs'] ) && false !== strpos( $html, 'The product tour is unavailable right now. Please try again shortly.' ), "$label: nothing stored, reason logged, tiny page" );
	ok( 1 === $aux['backoff'] && 300 === $aux['ttl'], "$label: a 5-minute back-off is set" );
}
/* failed or mismatched fetch with an older intact copy cached: serve it with 200, log it, back off */
$older = '<!doctype html><title>older tour</title>';
foreach ( array( 'old404' => '404', 'oldbad' => 'mismatch' ) as $m => $label ) {
	list( $html, $j, $aux ) = $serve( $m );
	$h = implode( "\n", $j['hdr'] );
	ok( 200 === $j['status'] && $older === $html && false !== strpos( $h, 'Cache-Control: public, max-age=3600' ), "$label with an older copy cached: the cached copy is served with 200" );
	ok( 1 === $aux['http'] && 1 === count( $aux['logs'] ) && false !== strpos( $aux['logs'][0], 'serving the cached copy' ) && 1 === $aux['backoff'] && 300 === $aux['ttl'] && hash( 'sha256', $older ) === $aux['stored'], "$label: logged, backed off for 5 minutes, the cached copy is kept" );
}
/* inside the back-off window: no fetch at all */
list( $html, $j, $aux ) = $serve( 'oldbackoff' );
ok( 200 === $j['status'] && $older === $html && 0 === $aux['http'] && 1 === count( $aux['logs'] ), 'back-off with an older copy cached: served, no HTTP call, logged' );
list( $html, $j, $aux ) = $serve( 'backoff' );
ok( 503 === $j['status'] && 0 === $aux['http'] && null === $aux['stored'], 'back-off with nothing cached: 503, no HTTP call' );

foreach ( array( array( '/industries/telco/', 'GET' ), array( '/industries/telco/tour/x', 'GET' ), array( '/industries/telco/tour/', 'POST' ), array( '/industries/pharmacy/', 'GET' ), array( '/industries/pharmacy/tour/x', 'GET' ), array( '/industries/pharmacy/tour/', 'POST' ), array( '/industries/convenience/', 'GET' ), array( '/industries/convenience/tour/x', 'GET' ), array( '/industries/convenience/tour/', 'POST' ), array( '/industries/grocery/tour/', 'GET' ) ) as $c ) {
	$out = shell_exec( 'php ' . escapeshellarg( __DIR__ . '/tour-serve.php' ) . ' ' . escapeshellarg( $c[0] ) . ' ' . $c[1] );
	ok( false !== strpos( (string) $out, '"fellThrough":true' ), $c[1] . ' ' . $c[0] . ' is left to WordPress' );
}
$out = shell_exec( 'php ' . escapeshellarg( __DIR__ . '/tour-serve.php' ) . ' /industries/telco/tour/ GET' );
ok( false === strpos( (string) $out, 'fellThrough' ) && 0 === ( json_decode( substr( $out, strrpos( $out, "\n@@" ) + 3 ), true )['status'] ?? 1 ) - 200, 'route exits after answering' );
preg_match( '/@@\{"fellThrough":true,"prio":(\d+)\}/', (string) shell_exec( 'php ' . escapeshellarg( __DIR__ . '/tour-serve.php' ) . ' /x/ GET' ), $pm );
ok( isset( $pm[1] ) && '0' === $pm[1], 'registered at template_redirect priority 0' );

/* generated PHP equals the repo source */
$src = file_get_contents( $dir . '/tour/tour.html' );
$php = file_get_contents( $dir . '/tour-page.php' );
ok( hash( 'sha256', require $dir . '/tour-page.php' ) === hash( 'sha256', $src ), 'tour-page.php returns tour.html byte for byte (sha256)' );
ok( 0 === preg_match( '/^PHTOUR/m', $src ), 'no line of tour.html starts with PHTOUR' );
ok( 1 === preg_match_all( '/^PHTOUR/m', $php ), 'tour-page.php has exactly one PHTOUR terminator line' );
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
function get_post_meta( $id, $k, $single = false ) { return $GLOBALS['meta'][ $id ][ $k ] ?? ''; }
/* WP_Query stub: finds a lead by email and test flag only while $GLOBALS['dedupe'] is on (earlier cases repeat one email and expect new posts). */
$GLOBALS['dedupe'] = false;
class WP_Query { public $posts = array(); function __construct( $a ) { if ( empty( $GLOBALS['dedupe'] ) ) { return; } $email = $a['meta_query'][0]['value']; $test = isset( $a['meta_query'][1]['value'] );
	foreach ( $GLOBALS['meta'] as $id => $m ) { if ( ( $m['ph_lead_email'] ?? '' ) === $email && ( '1' === ( $m['ph_lead_test'] ?? '' ) ) === $test ) { $this->posts[] = $id; break; } } } }
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
/* one lead per person: a second capture (here the calculator's) adds activity to the existing ph_lead, no second post */
$GLOBALS['dedupe'] = true; $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['fired'] = array();
$call( $good, '5.5.5.5' );
ok( 1 === count( $GLOBALS['posts'] ) && 1 === count( $GLOBALS['meta'][1]['ph_lead_activity'] ), 'first capture stores one lead with one activity row' );
$id2 = \AngieSnippets\PhIndustryEnhancements_10063\lead_find_existing( 'ada@nimbus.example', false );
ok( 1 === $id2, 'lead_find_existing finds the lead by email' );
ok( 0 === \AngieSnippets\PhIndustryEnhancements_10063\lead_find_existing( 'ada@nimbus.example', true ), 'a test capture is a separate lead from a real one' );
\AngieSnippets\PhIndustryEnhancements_10063\lead_add_activity( 1, 'Telco business model download' );
$labels = array_column( $GLOBALS['meta'][1]['ph_lead_activity'], 'label' );
ok( array( 'Interactive product tour – Telco', 'Telco business model download' ) === $labels, 'activity lists the tour and the download on the one lead' );
$call( array_merge( $good, array( 'flow' => 'Campaign creation' ) ), '6.6.6.6' );
ok( 1 === count( $GLOBALS['posts'] ) && 3 === count( $GLOBALS['meta'][1]['ph_lead_activity'] ) && 'ph_lead_captured' === end( $GLOBALS['fired'] )[0], 'a repeat tour capture adds activity, creates no second post and still reaches the console' );
$GLOBALS['dedupe'] = false;
for ( $i = 0; $i < 12; $i++ ) { $r = $call( $good, '9.9.9.9' ); }
ok( 429 === $r->status, 'throttled after 10 per hour per address' );

/* pharmacy: industry comes from the body and is validated against the config map */
$GLOBALS['dedupe'] = false; $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['fired'] = array(); $GLOBALS['mails'] = array(); $GLOBALS['tr'] = array();
$gp = array_merge( $good, array( 'industry' => 'pharmacy', 'company' => 'Harbour Pharmacy Group', 'page' => '/industries/pharmacy/tour/' ) );
$r = $call( $gp, '11.1.1.1' );
$m = $GLOBALS['meta'][1] ?? array();
ok( 200 === $r->status && 'Interactive product tour – Pharmacy' === ( $m['ph_lead_source_label'] ?? '' ) && '/industries/pharmacy/' === ( $m['ph_lead_page'] ?? '' ) && 'interactive-product-tour' === ( $m['ph_lead_source'] ?? '' ), 'pharmacy lead: source label and page are pharmacy' );
ok( 1 === count( $GLOBALS['mails'] ) && 'New Pharmacy product tour lead: Harbour Pharmacy Group' === $GLOBALS['mails'][0][1], 'pharmacy lead: admin email subject names Pharmacy' );
$pp = $GLOBALS['fired'][0][1] ?? array();
ok( 'pharmacy' === $pp['industry'] && 'Interactive product tour – Pharmacy' === $pp['source_label'] && '/industries/pharmacy/' === $pp['page'], 'pharmacy lead: ph_lead_captured carries industry pharmacy' );
$pb = \AngieSnippets\PhIndustryEnhancements_10063\lead_ingest_body( $pp );
ok( 'Interactive product tour – Pharmacy' === $pb['sourceLabel'] && '/industries/pharmacy/' === $pb['page'] && 'pharmacy' === $pb['pageIndustry'], 'pharmacy lead: ingest body sourceLabel, page and industry' );
$GLOBALS['posts'] = array(); $GLOBALS['fired'] = array();
foreach ( array( 'grocery', 'TELCO', '', null, array( 'pharmacy' ), 'telco ' ) as $bad ) {
	$r = $call( array_merge( $good, array( 'industry' => $bad ) ) );
	ok( 400 === $r->status && 'industry' === ( $r->data['field'] ?? '' ), 'unknown industry refused with 400: ' . json_encode( $bad ) );
}
$nb = $good; unset( $nb['industry'] );
$r = $call( $nb ); ok( 400 === $r->status, 'a missing industry is refused with 400' );
ok( ! $GLOBALS['posts'] && ! $GLOBALS['fired'], 'a refused industry stores and fires nothing' );
/* retail media: its own path, label, page and flow names */
$GLOBALS['dedupe'] = false; $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['fired'] = array(); $GLOBALS['mails'] = array(); $GLOBALS['tr'] = array();
$gr = array_merge( $good, array( 'industry' => 'retail-media', 'company' => 'Corner Stores Group', 'flow' => 'Shopper journey & outcome', 'page' => '/industries/retail-media/tour/' ) );
$r = $call( $gr, '11.1.1.9' );
$m = $GLOBALS['meta'][1] ?? array();
ok( 200 === $r->status && 'Interactive product tour – Retail Media' === ( $m['ph_lead_source_label'] ?? '' ) && '/industries/retail-media/' === ( $m['ph_lead_page'] ?? '' ), 'retail media lead: source label and page' );
ok( 'Shopper journey & outcome' === ( $m['ph_lead_tour_flow'] ?? '' ), 'retail media lead: the demo name is stored as the flow' );
ok( 'retail-media' === ( $GLOBALS['fired'][0][1]['industry'] ?? '' ), 'retail media lead: ph_lead_captured carries industry retail-media' );
$GLOBALS['posts'] = array(); $GLOBALS['fired'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['mails'] = array();
/* fuel & convenience: its own industry, page, label and flow name */
$GLOBALS['dedupe'] = false; $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['fired'] = array(); $GLOBALS['mails'] = array();
$gc = array_merge( $good, array( 'industry' => 'convenience', 'company' => 'Roadside Fuel Group', 'page' => '/industries/convenience/tour/', 'flow' => 'Fuel & convenience walkthrough' ) );
$r = $call( $gc, '13.1.1.1' );
$m = $GLOBALS['meta'][1] ?? array();
ok( 200 === $r->status && 'Interactive product tour – Fuel & Convenience' === ( $m['ph_lead_source_label'] ?? '' ) && '/industries/convenience/' === ( $m['ph_lead_page'] ?? '' ) && 'Fuel & convenience walkthrough' === ( $m['ph_lead_tour_flow'] ?? '' ), 'convenience lead: source label, page and flow' );
ok( 1 === count( $GLOBALS['mails'] ) && 'New Fuel & Convenience product tour lead: Roadside Fuel Group' === $GLOBALS['mails'][0][1], 'convenience lead: admin email subject names Fuel & Convenience' );
ok( 'convenience' === end( $GLOBALS['fired'] )[1]['industry'] && 'Fuel & convenience walkthrough' === end( $GLOBALS['fired'] )[1]['flow'], 'convenience capture reaches the console with industry convenience' );
/* one lead per person across both tours: a telco lead, then the same person on the pharmacy tour */
$GLOBALS['dedupe'] = true; $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['fired'] = array();
$call( $good, '12.1.1.1' );
$call( array_merge( $good, array( 'industry' => 'pharmacy', 'flow' => 'Personalisation' ) ), '12.1.1.2' );
$labels = array_column( $GLOBALS['meta'][1]['ph_lead_activity'] ?? array(), 'label' );
ok( 1 === count( $GLOBALS['posts'] ) && array( 'Interactive product tour – Telco', 'Interactive product tour – Pharmacy' ) === $labels, 'a telco lead is not asked again on pharmacy: one lead, activity for both tours' );
ok( 'ph_lead_captured' === end( $GLOBALS['fired'] )[0] && 'pharmacy' === end( $GLOBALS['fired'] )[1]['industry'], 'the pharmacy capture still reaches the console with industry pharmacy' );
$GLOBALS['dedupe'] = false;

/* POST ph-site/v1/tour-brand: the visitor's logos from the console, only for a lead this site captured, key never in the answer. */
$GLOBALS['brand_http'] = array(); $GLOBALS['brand_res'] = null;
function wp_remote_post( $u, $a = array() ) { $GLOBALS['brand_http'][] = array( $u, $a ); return $GLOBALS['brand_res']; }
function wp_remote_retrieve_response_code( $r ) { return $r['code'] ?? 0; }
function wp_remote_retrieve_body( $r ) { return $r['body'] ?? ''; }
$broute = $GLOBALS['routes']['ph-site/v1/tour-brand'] ?? null;
ok( $broute && 'POST' === $broute['methods'], 'POST ph-site/v1/tour-brand is registered' );
$bcall = function ( array $b, $ip = null ) use ( $broute, &$n_ip ) { $_SERVER['REMOTE_ADDR'] = $ip ?? '20.0.0.' . ( ++$n_ip ); return $broute['callback']( new WP_REST_Request( $b ) ); };
$ns = '\\AngieSnippets\\PhIndustryEnhancements_10063\\';
$GLOBALS['tr'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['posts'] = array(); $GLOBALS['opts']['ph_lead_ingest_key'] = 'secret-lead-key';
$console = array( 'found' => true, 'name' => 'Acme Test Mobile', 'industry' => 'Telco', 'logos' => array( 'light' => 'https://firebasestorage.googleapis.com/v0/b/x/o/brand%2Facme%2Flight.svg?alt=media', 'dark' => 'https://upload.wikimedia.org/acme-white.svg', 'icon' => 'https://acme.example/icon.png' ), 'darkFromLight' => false );
$GLOBALS['brand_res'] = array( 'code' => 200, 'body' => json_encode( $console ) );
$ab = array( 'company' => 'Acme Test Mobile', 'email' => 'sam@acmetest.example' );
$r = $bcall( $ab );
ok( 200 === $r->status && false === $r->data['found'] && ! $GLOBALS['brand_http'], 'a company nobody submitted: found false, the console is not asked' );
call_user_func( $ns . 'tour_brand_grant', array( 'company' => 'Acme Test Mobile', 'email' => 'sam@acmetest.example', 'test' => true ) );
$r = $bcall( $ab );
ok( false === $r->data['found'] && ! $GLOBALS['brand_http'], 'a test lead grants nothing' );
call_user_func( $ns . 'tour_brand_grant', array( 'company' => 'Acme Test Mobile', 'email' => 'sam@acmetest.example', 'test' => false ) );
$r = $bcall( array( 'company' => 'acme test mobile ', 'email' => 'SAM@acmetest.example' ) );
ok( 200 === $r->status && true === $r->data['found'], 'after the visitor submitted it (ph_lead_captured): found, case and spaces ignored' );
ok( array( 'found', 'logos', 'darkFromLight' ) === array_keys( $r->data ) && $console['logos'] === $r->data['logos'] && false === $r->data['darkFromLight'], 'answers only the logos: ' . json_encode( $r->data ) );
ok( false === strpos( json_encode( $r->data ), 'secret-lead-key' ), 'the lead key is not in the answer' );
list( $u, $a ) = $GLOBALS['brand_http'][0];
ok( 'https://backlog-tracker-e4ed2.web.app/leadIngest/v1/brand' === $u && 'secret-lead-key' === $a['headers']['X-Lead-Key'] && 3 === $a['timeout'], 'server to server: the brand route, X-Lead-Key, 3 s timeout' );
ok( array( 'company' => 'acme test mobile', 'email' => 'SAM@acmetest.example' ) === json_decode( $a['body'], true ), 'body is {company, email}' );
$r = $bcall( array( 'company' => 'Other Corp', 'email' => 'sam@acmetest.example' ) );
ok( false === $r->data['found'] && 1 === count( $GLOBALS['brand_http'] ), 'another company with the same email is not looked up' );
/* a lead captured before the grant existed: its stored company and email allow it */
$GLOBALS['dedupe'] = true; $GLOBALS['meta'][77] = array( 'ph_lead_email' => 'kim@orbit.example', 'ph_lead_company' => 'Orbit Telecom' );
$r = $bcall( array( 'company' => 'Orbit Telecom', 'email' => 'kim@orbit.example' ) );
ok( true === $r->data['found'], 'an existing ph_lead with that email and company is allowed' );
$GLOBALS['dedupe'] = false;
$cases = array(
	'dark empty, darkFromLight' => array( array( 'code' => 200, 'body' => json_encode( array( 'found' => true, 'logos' => array( 'light' => 'https://a.example/l.svg', 'dark' => '', 'icon' => '' ), 'darkFromLight' => true ) ) ), function ( $d ) { return true === $d['found'] && '' === $d['logos']['dark'] && true === $d['darkFromLight']; } ),
	'found false' => array( array( 'code' => 200, 'body' => '{"found":false}' ), function ( $d ) { return array( 'found' => false ) === $d; } ),
	'500' => array( array( 'code' => 500, 'body' => '{"error":"x"}' ), function ( $d ) { return array( 'found' => false ) === $d; } ),
	'timeout' => array( array( 'code' => 0, 'body' => '' ), function ( $d ) { return array( 'found' => false ) === $d; } ),
	'not json' => array( array( 'code' => 200, 'body' => '<html>' ), function ( $d ) { return array( 'found' => false ) === $d; } ),
	'only unsafe addresses' => array( array( 'code' => 200, 'body' => json_encode( array( 'found' => true, 'logos' => array( 'light' => 'javascript:alert(1)', 'dark' => 'http://a.example/d.png', 'icon' => 'https://a.example/"><script>' ) ) ) ), function ( $d ) { return array( 'found' => false ) === $d; } ),
);
foreach ( $cases as $label => $c ) {
	$GLOBALS['brand_res'] = $c[0];
	$r = $bcall( $ab );
	ok( 200 === $r->status && $c[1]( $r->data ), "console $label: " . json_encode( $r->data ) );
}
$GLOBALS['brand_res'] = array( 'code' => 200, 'body' => json_encode( $console ) );
unset( $GLOBALS['opts']['ph_lead_ingest_key'] ); $n = count( $GLOBALS['brand_http'] );
$r = $bcall( $ab );
ok( false === $r->data['found'] && $n === count( $GLOBALS['brand_http'] ), 'no lead key on the site: found false, no call' );
$GLOBALS['opts']['ph_lead_ingest_key'] = 'secret-lead-key';
$r = $bcall( array( 'company' => '', 'email' => 'sam@acmetest.example' ) ); ok( 400 === $r->status, 'company required' );
$r = $bcall( array( 'company' => 'Acme Test Mobile', 'email' => 'nope' ) ); ok( 400 === $r->status, 'valid email required' );
for ( $i = 0; $i < 12; $i++ ) { $r = $bcall( $ab, '21.1.1.1' ); }
ok( 429 === $r->status, 'tour-brand throttled after 10 per hour per address' );
$r = $bcall( $ab, '21.1.1.2' ); ok( 200 === $r->status, 'another address is not throttled' );
$src_t = (string) file_get_contents( $dir . '/tour/tour.html' ) . (string) file_get_contents( $dir . '/enhance.js' );
ok( false === stripos( $src_t, 'X-Lead-Key' ) && false === strpos( $src_t, 'leadIngest' ), 'the browser code never names the console route or the key header' );
$GLOBALS['tr'] = array();

/* retail media assets: the same-origin route (allow-list, sha check, file cache, ranges, 404, 503). A child process per request, because the handler exits. */
$asset = function ( $uri, $mode, $range = '', $method = 'GET' ) {
	$env = 'ASSET_MODE=' . $mode . ( '' !== $range ? ' HTTP_RANGE=' . escapeshellarg( $range ) : '' );
	return json_decode( (string) shell_exec( $env . ' php ' . escapeshellarg( __DIR__ . '/tour-asset-serve.php' ) . ' ' . escapeshellarg( $uri ) . ' ' . $method . ' 2>/dev/null' ), true ) ?: array( 'status' => -1, 'hdr' => array() );
};
$hdr = function ( $r, $name ) { foreach ( $r['hdr'] as $h ) { if ( 0 === stripos( $h, $name . ':' ) ) { return trim( substr( $h, strlen( $name ) + 1 ) ); } } return null; };
$A = '/industries/retail-media/tour/assets/v1/img/01-advertiser.jpg';
$r = $asset( $A, 'miss' );
ok( 200 === $r['status'] && $r['body_ok'] && 1 === $r['http'] && $r['cached_ok'], 'asset: a cache miss fetches once, checks the sha, stores the file and serves it' );
ok( 'https://raw.githubusercontent.com/offline2online/rob_ph_demos/tour-assets-retail-media-v1/ph-website/tour-assets/retail-media/img/01-advertiser.jpg' === $r['url'], 'asset: fetched from the pinned tag, not main' );
ok( 'image/jpeg' === $hdr( $r, 'Content-Type' ) && 'public, max-age=31536000, immutable' === $hdr( $r, 'Cache-Control' ) && 'noindex' === $hdr( $r, 'X-Robots-Tag' ) && 'bytes' === $hdr( $r, 'Accept-Ranges' ) && '1000' === $hdr( $r, 'Content-Length' ), 'asset: jpeg, immutable cache, noindex, Accept-Ranges, Content-Length' );
$r = $asset( $A, 'cached' );
ok( 200 === $r['status'] && $r['body_ok'] && 0 === $r['http'], 'asset: an intact cached file is served with no fetch' );
$r = $asset( $A, 'stale' );
ok( 200 === $r['status'] && $r['body_ok'] && 1 === $r['http'] && $r['cached_ok'], 'asset: a cached file with the wrong sha is replaced from the tag' );
$r = $asset( $A, 'cached', 'bytes=100-199' );
ok( 206 === $r['status'] && 100 === $r['len'] && 'bytes 100-199/1000' === $hdr( $r, 'Content-Range' ) && 'bytes' === $hdr( $r, 'Accept-Ranges' ) && '100' === $hdr( $r, 'Content-Length' ), 'asset: a byte range answers 206 with Content-Range' );
$r = $asset( $A, 'cached', 'bytes=0-' );
ok( 206 === $r['status'] && 1000 === $r['len'] && 'bytes 0-999/1000' === $hdr( $r, 'Content-Range' ), 'asset: an open-ended range (Safari audio probe) answers 206' );
$r = $asset( $A, 'cached', 'bytes=-50' );
ok( 206 === $r['status'] && 50 === $r['len'] && 'bytes 950-999/1000' === $hdr( $r, 'Content-Range' ), 'asset: a suffix range answers the last bytes' );
$r = $asset( $A, 'cached', 'bytes=900-5000' );
ok( 206 === $r['status'] && 100 === $r['len'] && 'bytes 900-999/1000' === $hdr( $r, 'Content-Range' ), 'asset: a range past the end is clamped' );
$r = $asset( $A, 'cached', 'bytes=1000-1100' );
ok( 416 === $r['status'] && 'bytes */1000' === $hdr( $r, 'Content-Range' ) && 0 === $r['len'], 'asset: an unsatisfiable range answers 416' );
$r = $asset( $A, 'cached', 'bytes=0-9,20-29' );
ok( 200 === $r['status'] && 1000 === $r['len'], 'asset: multiple ranges are ignored and the whole file is sent' );
$r = $asset( $A, 'cached', '', 'HEAD' );
ok( 200 === $r['status'] && 0 === $r['len'] && '1000' === $hdr( $r, 'Content-Length' ), 'asset: HEAD sends headers and no body' );
foreach ( array( 'img/nope.jpg', 'vo/01-advertiser.jpg', 'img/../tour.php', 'img/01-advertiser.jpg.php', 'x/01-advertiser.jpg', 'img/', 'img/%2e%2e/tour.php' ) as $bad ) {
	$r = $asset( '/industries/retail-media/tour/assets/v1/' . $bad, 'cached' );
	ok( 404 === $r['status'] && 0 === $r['http'], "asset: $bad is not in the allow-list and answers 404" );
}
$r = $asset( '/industries/retail-media/tour/assets/v1/img/01-advertiser.jpg', 'cached', '', 'POST' );
ok( 0 === $r['status'] || -1 === $r['status'] || ( 200 !== $r['status'] && 206 !== $r['status'] ), 'asset: POST is not served' );
$r = $asset( $A, 'bad' );
ok( 503 === $r['status'] && '60' === $hdr( $r, 'Retry-After' ) && 'no-store' === $hdr( $r, 'Cache-Control' ) && ! $r['cached'] && 60 === $r['backoff_ttl'] && 1 === count( $r['logs'] ) && false !== strpos( $r['logs'][0], 'does not match' ), 'asset: bytes that fail the sha are never stored or served: 503, Retry-After, 60 s back-off, one error_log line' );
$r = $asset( $A, '404' );
ok( 503 === $r['status'] && ! $r['cached'] && 60 === $r['backoff_ttl'] && false !== strpos( $r['logs'][0] ?? '', 'answered 404' ), 'asset: a failed fetch with nothing cached answers 503 and backs off' );
$r = $asset( $A, 'backoff' );
ok( 503 === $r['status'] && 0 === $r['http'] && false !== strpos( $r['logs'][0] ?? '', 'backing off' ), 'asset: during the back-off there is no fetch' );
$r = $asset( $A, 'mirror' );
ok( 200 === $r['status'] && $r['body_ok'] && 2 === $r['http'] && $r['cached_ok'] && false !== strpos( (string) $r['url'], 'https://cdn.jsdelivr.net/gh/offline2online/rob_ph_demos@tour-assets-retail-media-v1/ph-website/tour-assets/retail-media/' ) && null === $r['backoff_ttl'], 'asset: when the tag fetch fails the jsDelivr mirror is used, the file is cached and no back-off is set' );
$r = $asset( $A, 'bad' );
ok( false !== strpos( $r['logs'][0] ?? '', 'received 11 bytes, first 16 as hex 77726f6e67206279746573' ), 'asset: a sha mismatch logs the received length and the first 16 bytes as hex' );
$r = $asset( $A, 'both404' );
ok( 503 === $r['status'] && 'fetch-failed' === $hdr( $r, 'X-PH-Tour-Reason' ) && 2 === $r['http'] && ! $r['cached'] && 60 === $r['backoff_ttl'] && 1 === count( $r['logs'] ) && false !== strpos( $r['logs'][0], 'tag fetch answered 404' ) && false !== strpos( $r['logs'][0], 'mirror fetch answered 404' ), 'asset: both sources failing answers 503 with X-PH-Tour-Reason fetch-failed, backs off and logs both reasons' );
$r = $asset( $A, 'bad' );
ok( 'sha-mismatch' === $hdr( $r, 'X-PH-Tour-Reason' ) && 2 === $r['http'] && 503 === $r['status'], 'asset: a sha mismatch from both sources gives X-PH-Tour-Reason sha-mismatch' );
$r = $asset( $A, 'backoff' );
ok( 'backoff' === $hdr( $r, 'X-PH-Tour-Reason' ), 'asset: during the back-off the 503 says X-PH-Tour-Reason backoff' );
$r = $asset( $A, 'cached' );
$r2 = $asset( $A, 'cached', 'bytes=0-9' );
$r3 = $asset( $A, 'cached', 'bytes=1000-1100' );
ok( array( 'Pragma', 'Expires' ) === $r['removed'] && array( 'Pragma', 'Expires' ) === $r2['removed'] && 200 === $r['status'] && 206 === $r2['status'], 'asset: a 200 and a 206 remove Pragma and Expires so the immutable Cache-Control holds for logged-in users' );
ok( array() === $r3['removed'] && array() === $asset( $A, 'both404' )['removed'] && array() === $asset( '/industries/retail-media/tour/assets/v1/img/nope.jpg', 'cached' )['removed'], 'asset: 416, 503 and 404 responses are left as they were' );
ok( 'audio/mpeg' === \AngieSnippets\PhIndustryEnhancements_10063\tour_asset_mime( 'vo/a.mp3' ) && 'image/jpeg' === \AngieSnippets\PhIndustryEnhancements_10063\tour_asset_mime( 'img/a.jpg' ), 'asset: mime types' );
/* the allow-list is exactly the shipped SHA256SUMS (kept in tools/retail-media-tour? no: on the tag), and covers the files tour.html asks for */
$map = \AngieSnippets\PhIndustryEnhancements_10063\TOUR_ASSETS;
ok( 111 === count( $map ) && 33 === count( preg_grep( '#^img/#', array_keys( $map ) ) ) && 77 === count( preg_grep( '#^vo/.*\.mp3$#', array_keys( $map ) ) ) && isset( $map['vo/manifest.json'] ), 'asset: 33 images, 77 voiceover clips and the manifest are allow-listed' );
$bad_shape = array_filter( $map, function ( $v ) { return ! is_array( $v ) || 1 !== preg_match( '/^[0-9a-f]{64}$/', $v[0] ) || ! is_int( $v[1] ) || $v[1] < 1; } );
ok( ! $bad_shape, 'asset: every allow-list entry is a sha256 and a byte size' );
$manifest_files = array();
preg_match( '/const CLIPS = (\{.*?\}), BASE = /s', $src, $cm );
if ( ! empty( $cm[1] ) ) { foreach ( json_decode( $cm[1], true ) as $lines ) { foreach ( $lines as $l ) { $manifest_files[] = 'vo/' . $l['file']; } } }
ok( 77 === count( $manifest_files ) && ! array_diff( $manifest_files, array_keys( $map ) ), 'asset: every voiceover clip tour.html plays is allow-listed (' . count( $manifest_files ) . ')' );
preg_match_all( '/"([\w-]+)(?:#[\w-]+)?":\[\d+,\d+,\d+,\d+\]/', $src, $im ); // the screenshots named in HOT (the click and highlight boxes), plus the login backdrop
$img_used = array_unique( array_merge( $im[1], array( 'login-bg' ) ) );
ok( count( $img_used ) === 33 && ! array_filter( $img_used, function ( $f ) use ( $map ) { return ! isset( $map[ 'img/' . $f . '.jpg' ] ); } ), 'asset: every screenshot tour.html names (' . count( $img_used ) . ') is allow-listed: ' . implode( ' ', array_filter( $img_used, function ( $f ) use ( $map ) { return ! isset( $map[ 'img/' . $f . '.jpg' ] ); } ) ) );

/* the free-mail list is the tour's own */
preg_match( '/const FREE_MAIL = (\/.*?\/i);/', $src, $mm );
ok( ! empty( $mm[1] ) && \AngieSnippets\PhIndustryEnhancements_10063\tour_free_mail( 'x@gmail.com' ) === (bool) preg_match( $mm[1], 'x@gmail.com' ), 'FREE_MAIL found in the tour' );
preg_match( '/@\((.*?)\)\\\\\./', $mm[1] ?? '', $names ); // the alternation inside @( ... )\.
$php_re = file_get_contents( $dir . '/tour.php' );
preg_match( '/@\(([^)]*)\)\\\\\./', $php_re, $pn );
ok( ! empty( $names[1] ) && ( $names[1] ?? 'a' ) === ( $pn[1] ?? 'b' ), 'tour.php free-domain list equals the tour FREE_MAIL' );

echo $fails ? "$fails failed\n" : "tour: all passed\n"; exit( $fails ? 1 : 0 );
}
