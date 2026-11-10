<?php
/**
 * Child process for tour.test.php: runs the retail media asset route for one request (the handler exits) and prints what it sent.
 * usage: ASSET_MODE=<mode> [HTTP_RANGE=<header>] php tour-asset-serve.php <uri> [METHOD]
 * The allow-list entry img/01-advertiser.jpg is swapped for a 1000-byte fixture so the test needs no network and no binary files.
 * ASSET_MODE: mirror (tag answers 404, the jsDelivr mirror has the fixture) | both404 (tag and mirror answer 404) | badboth (both answer other bytes) | miss (empty cache, tag answers with the fixture) | cached (intact file already in uploads) | stale (cached file has the wrong bytes) | bad (tag answers with other bytes) | 404 (tag answers 404) | backoff (back-off transient set, empty cache) | seed (real vo clip, empty cache, network 404: the embedded copy serves) | badseed (same, embedded copy corrupted: falls through to the fetches, which 404)
 */
namespace AngieSnippets\PhIndustryEnhancements_10063 {
	function header( $h ) { $GLOBALS['hdr'][] = $h; }
	function header_remove( $h ) { $GLOBALS['removed'][] = $h; }
	function status_header( $c ) { $GLOBALS['status'] = $c; }
	function error_log( $m ) { $GLOBALS['logs'][] = $m; }
	function data( $f ) { return ''; }
}
namespace {
define( 'ABSPATH', '/' );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'MINUTE_IN_SECONDS', 60 );
$GLOBALS['removed'] = array(); $GLOBALS['hdr'] = array(); $GLOBALS['status'] = 0; $GLOBALS['cbs'] = array(); $GLOBALS['logs'] = array(); $GLOBALS['http'] = 0; $GLOBALS['tr'] = array(); $GLOBALS['trttl'] = array();
function add_action( $n, $cb, $p = 10 ) { $GLOBALS['cbs'][ $n ][] = array( $p, $cb ); }
function wp_unslash( $v ) { return $v; } function sanitize_text_field( $v ) { return $v; }
function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); }
function is_wp_error( $r ) { return false; }
function get_transient( $k ) { return $GLOBALS['tr'][ $k ] ?? false; } function set_transient( $k, $v, $t = 0 ) { $GLOBALS['tr'][ $k ] = $v; $GLOBALS['trttl'][ $k ] = $t; }
function wp_mkdir_p( $d ) { return is_dir( $d ) || mkdir( $d, 0777, true ); }
$mode = getenv( 'ASSET_MODE' ) ?: 'miss';
$seedmode = in_array( $mode, array( 'seed', 'badseed' ), true );
$VO = 'vo/f1-03-3-b1b956b775.mp3';
$tmp  = sys_get_temp_dir() . '/tour-asset-' . getmypid();
mkdir( $tmp, 0777, true );
function wp_upload_dir() { global $tmp; return array( 'basedir' => $tmp . '/uploads' ); }
$fixture = ''; for ( $i = 0; $i < 1000; $i++ ) { $fixture .= chr( $i % 251 ); }
function wp_remote_get( $u, $a = array() ) {
	global $mode, $fixture; $GLOBALS['http']++; $GLOBALS['url'] = $u;
	$mirror = false !== strpos( $u, 'cdn.jsdelivr.net' );
	if ( $seedmode || 'both404' === $mode || ( 'mirror' === $mode && ! $mirror ) ) { return array( 'code' => 404, 'body' => '' ); }
	return array( 'code' => '404' === $mode ? 404 : 200, 'body' => 'bad' === $mode ? 'wrong bytes' : $fixture );
}
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }
$src = (string) file_get_contents( dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/tour.php' );
$new = preg_replace( "/'img\/01-advertiser\.jpg' => array\( '[0-9a-f]{64}', \d+ \)/", "'img/01-advertiser.jpg' => array( '" . hash( 'sha256', $fixture ) . "', 1000 )", $src, 1, $n );
if ( 1 !== $n ) { fwrite( STDERR, "fixture swap failed\n" ); exit( 2 ); }
if ( 'badseed' === $mode ) { $new = preg_replace( "/(const TOUR_ASSET_SEED = array\(\s*'vo\/f1-03-3-b1b956b775\.mp3' => ')[^']+/", '${1}AAAA', $new, 1, $n2 ); if ( 1 !== $n2 ) { fwrite( STDERR, "seed swap failed\n" ); exit( 2 ); } }
file_put_contents( $tmp . '/tour.php', $new );
$cache = $tmp . '/uploads/ph-tour/retail-media/v1/' . ( $seedmode ? $VO : 'img/01-advertiser.jpg' );
if ( 'cached' === $mode || 'stale' === $mode ) { mkdir( dirname( $cache ), 0777, true ); file_put_contents( $cache, 'cached' === $mode ? $fixture : 'old bytes' ); }
if ( 'backoff' === $mode ) { $GLOBALS['tr']['ph_tour_asset_backoff_' . md5( 'img/01-advertiser.jpg' )] = 1; }
require $tmp . '/tour.php';
$_SERVER['REQUEST_METHOD'] = $argv[2] ?? 'GET'; $_SERVER['REQUEST_URI'] = $argv[1];
if ( getenv( 'HTTP_RANGE' ) ) { $_SERVER['HTTP_RANGE'] = getenv( 'HTTP_RANGE' ); }
ob_start();
register_shutdown_function( function () use ( $tmp, $cache, $fixture ) {
	$body = ob_get_clean();
	$on_disk = is_file( $cache ) ? file_get_contents( $cache ) : null;
	echo json_encode( array( 'status' => $GLOBALS['status'], 'hdr' => $GLOBALS['hdr'], 'removed' => $GLOBALS['removed'], 'len' => strlen( $body ), 'body_ok' => $body === $fixture, 'body_sha' => hash( 'sha256', $body ), 'http' => $GLOBALS['http'], 'url' => $GLOBALS['url'] ?? null, 'logs' => $GLOBALS['logs'], 'backoff_ttl' => $GLOBALS['trttl']['ph_tour_asset_backoff_' . md5( 'img/01-advertiser.jpg' )] ?? null, 'cached_ok' => $on_disk === $fixture, 'cached_sha' => null === $on_disk ? null : hash( 'sha256', $on_disk ), 'cached' => null !== $on_disk ) );
	@unlink( $cache ); exec( 'rm -rf ' . escapeshellarg( $tmp ) );
} );
list( $prio, $cb ) = $GLOBALS['cbs']['template_redirect'][0];
$cb();
}
