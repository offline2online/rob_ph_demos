<?php
/**
 * Offline tests for the floating CTA (snippets/ph-industry-enhancements/cta.php). Run from run.php in its own process, or on its own:
 *   php ph-website/tests/cta.test.php
 * The variant resolver (request on the Run Your Own RMN page, tour on a page with a guided tour, demo elsewhere), the ph_floating_cta
 * filter override and its clean-up, the enqueue (never in the Elementor editor or preview), main.php's require and operator.js no longer
 * rewriting the header's demo button. The browser half is tests/cta.test.mjs.
 */
error_reporting( E_ALL );
$fails = 0;
$n     = 0;
function ok( $cond, $msg ) {
	global $fails, $n;
	$n++;
	if ( ! $cond ) {
		$fails++;
		fwrite( STDERR, "FAIL: $msg\n" );
	}
}
define( 'ABSPATH', '/' );
$GLOBALS['hooks']   = array();
$GLOBALS['filter']  = null;
$GLOBALS['enq']     = array();
$GLOBALS['admin']   = false;
$GLOBALS['opage']   = false;
$GLOBALS['pkey']    = '';
function add_action( $tag, $fn, $p = 10 ) { $GLOBALS['hooks'][ $tag ][] = $fn; }
function add_filter( $tag, $fn, $p = 10 ) { $GLOBALS['hooks'][ $tag ][] = $fn; }
function apply_filters( $tag, $v, ...$args ) { return 'ph_floating_cta' === $tag && $GLOBALS['filter'] ? call_user_func( $GLOBALS['filter'], $v, ...$args ) : $v; }
function is_admin() { return $GLOBALS['admin']; }
function wp_json_encode( $v ) { return json_encode( $v, JSON_UNESCAPED_SLASHES ); }
function wp_enqueue_style( $h, $src ) { $GLOBALS['enq'][] = array( 'style', $h, $src ); }
function wp_enqueue_script( $h, $src ) { $GLOBALS['enq'][] = array( 'script', $h, $src ); }
function wp_add_inline_script( $h, $js, $pos ) { $GLOBALS['enq'][] = array( 'inline', $h, $js, $pos ); }
function angie_cs_get_snippet_asset_url( $file, $name ) { return 'https://x.test/snip/' . $name; }

$dir = dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/';
eval( 'namespace AngieSnippets\\PhIndustryEnhancements_10063; const PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063 = "t"; function page_key() { return $GLOBALS["pkey"]; } function operator_is_page() { return $GLOBALS["opage"]; }' );
require $dir . 'tour.php';
require $dir . 'cta.php';
use function AngieSnippets\PhIndustryEnhancements_10063\{cta_variant,cta_config,cta_tour_keys,cta_page_config,cta_enqueue,cta_here};

/* the resolver */
ok( 'request' === cta_variant( true, false ) && 'request' === cta_variant( true, true ), 'request on the Run Your Own RMN page (wins over its own tour)' );
ok( 'tour' === cta_variant( false, true ), 'tour on a page with a guided tour' );
ok( 'demo' === cta_variant( false, false ), 'demo everywhere else' );
$keys = cta_tour_keys();
sort( $keys );
ok( array( 'convenience', 'pharmacy', 'retail-media', 'telco' ) === $keys, 'tour pages: the industry tours from TOUR_INDUSTRIES, not the operator page: ' . implode( ',', $keys ) );

$c = cta_config( true, false );
ok( 'request' === $c['variant'] && 'Request further information' === $c['label'] && 'scroll' === $c['action'] && '#request-info' === $c['target'], 'request config: label, scroll, #request-info' );
$c = cta_config( false, true );
ok( 'tour' === $c['variant'] && 'Take the guided tour' === $c['label'] && 'scroll' === $c['action'] && '#ph-tour' === $c['target'], 'tour config: label, scroll, #ph-tour' );
$c = cta_config( false, false );
ok( 'demo' === $c['variant'] && 'Arrange a demo' === $c['label'] && 'demo' === $c['action'] && '' === $c['target'], 'demo config: label, the pop-up' );
ok( 2658 === $c['popup'] && 0 === strpos( $c['href'], 'https://calendly.com/rob-offline2online/30min' ), 'demo: popup 2658, falling back to the header\'s booking link' );
ok( false === $c['locked'] && false === $c['hidden'], 'defaults are not locked or hidden' );

/* page context: server-side where possible */
$GLOBALS['opage'] = true;
ok( 'request' === cta_page_config()['variant'], 'page config: the operator page is request' );
$GLOBALS['opage'] = false;
foreach ( array( 'telco', 'pharmacy', 'retail-media', 'convenience' ) as $k ) {
	$GLOBALS['pkey'] = $k;
	ok( 'tour' === cta_page_config()['variant'], "page config: $k is tour" );
}
foreach ( array( '', 'industries', 'grocery', 'hospitality' ) as $k ) {
	$GLOBALS['pkey'] = $k;
	ok( 'demo' === cta_page_config()['variant'], "page config: '$k' is demo" );
}
$GLOBALS['pkey'] = '';

/* the filter */
$GLOBALS['filter'] = function ( $cfg, $ctx ) {
	ok( is_array( $ctx ) && array_key_exists( 'operator', $ctx ) && array_key_exists( 'tour', $ctx ), 'filter gets the page context' );
	return array_merge( $cfg, array( 'variant' => 'calc', 'label' => 'Try the calculator', 'action' => 'scroll', 'target' => '#calculator' ) );
};
$c = cta_config( false, false );
ok( 'calc' === $c['variant'] && 'Try the calculator' === $c['label'] && 'scroll' === $c['action'] && '#calculator' === $c['target'] && true === $c['locked'], 'filter override: label and target, locked' );
$GLOBALS['filter'] = function ( $cfg ) { return array_merge( $cfg, array( 'label' => '<b>Book</b> now' ) ); };
$c = cta_config( false, true );
ok( 'Book now' === $c['label'] && 'tour' === $c['variant'] && $c['locked'], 'filter label is plain text' );
$GLOBALS['filter'] = function ( $cfg ) { return array_merge( $cfg, array( 'label' => str_repeat( 'x', 80 ), 'target' => 'javascript:alert(1)' ) ); };
$c = cta_config( false, true );
ok( 'Take the guided tour' === $c['label'] && '#ph-tour' === $c['target'] && false === $c['locked'], 'a too-long label and a non-anchor target fall back to the defaults' );
$GLOBALS['filter'] = function ( $cfg ) { return array_merge( $cfg, array( 'action' => 'scroll', 'target' => 'https://evil.test/' ) ); };
$c = cta_config( false, false );
ok( 'demo' === $c['action'] && '' === $c['target'], 'a demo page given a non-anchor target stays the pop-up' );
$GLOBALS['filter'] = function ( $cfg ) { return array_merge( $cfg, array( 'action' => 'demo' ) ); };
$c = cta_config( true, false );
ok( 'demo' === $c['action'] && '' === $c['target'] && $c['locked'], 'filter can turn a page back to the demo pop-up' );
$GLOBALS['filter'] = function ( $cfg ) { return 'nonsense'; };
ok( 'tour' === cta_config( false, true )['variant'], 'a filter returning a non-array is ignored' );
$GLOBALS['filter'] = function ( $cfg ) { $cfg['hidden'] = true; return $cfg; };
ok( true === cta_config( false, false )['hidden'], 'filter can hide the CTA' );

/* the enqueue */
cta_enqueue();
ok( array() === $GLOBALS['enq'], 'a hidden CTA enqueues nothing' );
$GLOBALS['filter'] = null;
cta_enqueue();
$names = array_map( function ( $e ) { return $e[2]; }, array_slice( $GLOBALS['enq'], 0, 2 ) );
ok( array( 'https://x.test/snip/cta.css', 'https://x.test/snip/cta.js' ) === $names, 'enqueues cta.css and cta.js' );
$inl = $GLOBALS['enq'][2];
ok( 'inline' === $inl[0] && 'before' === $inl[3] && 0 === strpos( $inl[2], 'window.PH_FLOATING_CTA = {' ) && false !== strpos( $inl[2], '"variant":"demo"' ), 'prints window.PH_FLOATING_CTA before cta.js' );
ok( isset( $GLOBALS['hooks']['wp_enqueue_scripts'] ) && in_array( 'AngieSnippets\\PhIndustryEnhancements_10063\\cta_enqueue', $GLOBALS['hooks']['wp_enqueue_scripts'], true ), 'hooked on wp_enqueue_scripts' );
foreach ( array( 'elementor-preview', 'preview_id', 'elementor_library' ) as $q ) {
	$_GET = array( $q => '1' );
	$GLOBALS['enq'] = array();
	cta_enqueue();
	ok( ! cta_here() && array() === $GLOBALS['enq'], "not in the Elementor editor or preview (?$q)" );
}
$_GET = array();
$GLOBALS['admin'] = true;
ok( ! cta_here(), 'not in wp-admin' );
$GLOBALS['admin'] = false;
ok( cta_here(), 'on the front end' );

/* wiring and clean-up */
$main = file_get_contents( $dir . 'main.php' );
ok( false !== strpos( $main, "require_once __DIR__ . '/cta.php';" ), 'main.php requires cta.php' );
$ojs = file_get_contents( $dir . 'operator.js' );
ok( false === strpos( $ojs, 'headerDemo' ) && false === strpos( $ojs, 'arrange\\s+a\\s+demo' ) && false === strpos( $ojs, 'data-phf-demo' ), 'operator.js no longer points the header\'s Arrange A Demo at #tour' );
$cjs = file_get_contents( $dir . 'cta.js' );
ok( false !== strpos( $cjs, 'event: "ph_floating_cta", variant: v' ), 'cta.js pushes ph_floating_cta with the variant only' );
ok( false !== strpos( $cjs, 'Request further information' ) && false !== strpos( $cjs, 'Take the guided tour' ) && false !== strpos( $cjs, 'Arrange a demo' ), 'cta.js labels match cta.php' );
foreach ( array( 'cta.php', 'cta.js', 'cta.css' ) as $f ) {
	$src = file_get_contents( $dir . $f );
	ok( 0 === preg_match( '/fr[a]nch|own[ -]bo[s]s|be-your[-]own|ph[-]bo[s]s/i', $src ), "$f: no retired names" );
}

fwrite( STDOUT, $fails ? "cta: $fails of $n checks FAILED\n" : "cta: all $n checks passed\n" );
exit( $fails ? 1 : 0 );
