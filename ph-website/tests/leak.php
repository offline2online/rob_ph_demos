<?php
/**
 * Leak suite for the site's agent endpoints. No WordPress, no network:
 *   php ph-website/tests/leak.php
 *
 * Seeds everything that must stay private - a draft, a scheduled page, a private
 * page, a password-protected page, a noindex page, demo/campaign pages outside the
 * allow-list, a pending help revision, an out-of-range release article and internal
 * fields (ph_help_* ids, hashes, programme, project) - then walks every endpoint and
 * fails, naming the endpoint, if any marker appears.
 *
 * Endpoints: llms.txt (ph_llms_txt filter), markdown twins, JSON-LD (wp_head), the
 * ph-agent/v1 tools list and every tool call, the WebMCP loader, and the Support
 * Centre's public routes (ph-help/v1/index and /published). The remote MCP server and
 * /help-api/* are covered by backlog-tracker/test/help-leak.test.js.
 */
error_reporting( E_ALL );
$fails = 0;
$n     = 0;
function leak_ok( $cond, $msg ) {
	global $fails, $n;
	$n++;
	if ( ! $cond ) {
		$fails++;
		fwrite( STDERR, "LEAK/FAIL: $msg\n" );
	}
}

/* Markers: one per kind of private thing. They appear in titles, summaries, bodies and meta. */
const MARKERS = array( 'LEAKDRAFT', 'LEAKFUTURE', 'LEAKPRIVATE', 'LEAKPASSWORD', 'LEAKNOINDEX', 'LEAKDEMO', 'LEAKPENDING', 'LEAKOUTOFRANGE', 'LEAKPHHELPID', 'LEAKHASH', 'LEAKPROGRAMME', 'LEAKPROJECT' );
function clean( $endpoint, $payload ) {
	$text = is_string( $payload ) ? $payload : json_encode( $payload );
	foreach ( MARKERS as $m ) {
		leak_ok( stripos( (string) $text, $m ) === false, "$endpoint exposes $m" );
	}
	leak_ok( stripos( (string) $text, 'ph_help_' ) === false, "$endpoint exposes a ph_help_* field name" );
}

$dir = dirname( __DIR__ ) . '/snippets/ph-agent-endpoint';
$sc  = file_get_contents( dirname( __DIR__ ) . '/snippets/ph-support-centre/main.php' );

/* ---- WordPress stubs ---- */
define( 'ABSPATH', '/' );
$GLOBALS['hooks']  = array();
$GLOBALS['routes'] = array();
$GLOBALS['opts']   = array();
$GLOBALS['tr']     = array();
$GLOBALS['q']      = 0;
function add_action( $h, $f, $p = 10 ) { $GLOBALS['hooks'][ $h ][] = $f; }
function add_filter( $h, $f, $p = 10 ) { $GLOBALS['hooks'][ $h ][] = $f; }
function post( $id, $status, $title, $pw = '', $body = '<p>Public body.</p>' ) {
	return (object) array( 'ID' => $id, 'post_type' => 'page', 'post_status' => $status, 'post_password' => $pw, 'post_title' => $title, 'post_excerpt' => "$title summary", 'post_modified_gmt' => 'x', 'post_content' => "<h1>$title</h1>$body" );
}
/* Allow-listed ids (see lib.php): 7020 Digital Signage is the good page; others are the private variants. */
$GLOBALS['posts'] = array(
	7020 => post( 7020, 'publish', 'Digital Signage' ),
	3477 => post( 3477, 'draft', 'LEAKDRAFT Store Sites', '', '<p>LEAKDRAFT body</p>' ),
	3566 => post( 3566, 'publish', 'LEAKPASSWORD Personalisation', 'secret', '<p>LEAKPASSWORD body</p>' ),
	3973 => post( 3973, 'future', 'LEAKFUTURE Page', '', '<p>LEAKFUTURE body</p>' ),
	2389 => post( 2389, 'private', 'LEAKPRIVATE Home', '', '<p>LEAKPRIVATE body</p>' ),
	555  => post( 555, 'publish', 'LEAKDEMO Lindt Chocolate', '', '<p>LEAKDEMO Lindt campaign</p>' ),
	556  => post( 556, 'publish', 'LEAKDEMO Webdemo', '', '<p>LEAKDEMO</p>' ),
);
function get_post( $id ) { return $GLOBALS['posts'][ (int) $id ] ?? null; }
function get_post_meta( $id, $k, $s = true ) {
	if ( 'ph_help_hash' === $k || 'ph_help_id' === $k ) { return 'LEAKHASH LEAKPHHELPID'; }
	if ( 'ph_help_programme' === $k ) { return 'LEAKPROGRAMME'; }
	if ( 'ph_help_project' === $k ) { return 'LEAKPROJECT'; }
	if ( '_seopress_robots_index' === $k && 4040 === (int) $id ) { return 'yes'; }
	return '';
}
function wp_strip_all_tags( $s ) { return strip_tags( (string) $s ); }
function get_the_title( $p ) { return $p->post_title; }
function is_singular() { return true; }
function get_queried_object_id() { return $GLOBALS['q']; }
function esc_url( $u ) { return $u; }
function delete_transient() {}
function register_rest_route( $ns, $route, $a ) { $GLOBALS['routes'][ $ns . $route ] = $a; }
function rest_ensure_response( $d ) { return new class( $d ) { public $d; public $h = array(); function __construct( $d ) { $this->d = $d; } function header( $k, $v ) { $this->h[ $k ] = $v; } function set_status( $c ) { $this->status = $c; } public $status = 200; }; }
function wp_salt() { return 'test-salt'; }
function get_option( $k, $d = false ) { return $GLOBALS['opts'][ $k ] ?? $d; }
function update_option( $k, $v ) { $GLOBALS['opts'][ $k ] = $v; }
function get_transient( $k ) { return $GLOBALS['tr'][ $k ] ?? false; }
function set_transient( $k, $v ) { $GLOBALS['tr'][ $k ] = $v; }
function wp_json_encode( $v ) { return json_encode( $v, JSON_UNESCAPED_SLASHES ); }
function rest_url( $p = '' ) { return 'https://personalisationhub.com/wp-json/' . $p; }
function get_page_by_path( $p ) { return null; }
function get_page_uri( $p ) { return ''; }
function home_url( $p = '' ) { return 'https://personalisationhub.com' . $p; }
function apply_filters( $h, $v ) { return $v; }
function get_queried_object() { return $GLOBALS['posts'][ $GLOBALS['q'] ] ?? null; }
function __return_true() { return true; }
function is_admin() { return false; }
function is_feed() { return false; }
function is_404() { return false; }
function is_tax() { return false; }

/* ---- Support Centre: its real release-range and search code over a seeded catalogue ---- */
$GLOBALS['opts']['ph_sc_releases'] = array(
	array( 'id' => 'r1', 'version' => '5.0', 'status' => 'live', 'order' => 1 ),
	array( 'id' => 'r2', 'version' => '6.0', 'status' => 'draft', 'order' => 2 ),
);
function sc_art( $cid, $title, $from = '', $to = '', $extra = array() ) {
	return array_merge( array( 'id' => (int) crc32( $cid ) % 90000, 'cid' => $cid, 'title' => $title, 'slug' => $cid, 'summary' => "$title summary", 'kw' => array( 'store' ), 'q' => array(), 'order' => 1, 'cat' => 1, 'from' => $from, 'to' => $to, 'hash' => 'LEAKHASH', 'updated' => '', 'answer' => '', 'type' => 'faq' ), $extra );
}
$GLOBALS['sc_arts'] = array(
	sc_art( 'pub', 'Add a store', 'r1' ),
	sc_art( 'future', 'LEAKOUTOFRANGE store feature', 'r2' ),
	sc_art( 'gone', 'LEAKOUTOFRANGE retired store feature', 'r1', 'r1' ),
);
$ns_src = 'namespace AngieSnippets\PhSupportCentre_10156; const LIVE = true; function catalogue() { return array( "arts" => $GLOBALS["sc_arts"], "cats" => array( 1 => array( "id" => 1, "cid" => "c1", "name" => "HQ Admin", "parent" => 0 ) ) ); }'
	. ' function cats() { return catalogue()["cats"]; } function parent_cat( $t ) { return catalogue()["cats"][1]; } function art_url( $a ) { return "https://personalisationhub.com/support-centre/hq-admin/" . $a["slug"] . "/"; }'
	. ' function sanitize_text_field( $s ) { return $s; } function wp_unslash( $s ) { return $s; }'
	. ' function markdown( $v ) { return "# " . $v["art"]["title"] . "\n"; }';
preg_match( '/^const STOPWORDS = .*?;$/ms', $sc, $m1 );
preg_match( '/^function search_terms\(.*?^}\n/ms', $sc, $m2 );
preg_match( '/^function search_articles\(.*?^}\n/ms', $sc, $m3 );
preg_match( '/^function releases\(.*?^}\n/ms', $sc, $m4 );
preg_match( '/^function target_release\(.*?^}\n/ms', $sc, $m5 );
preg_match( '/^function in_release\(.*?^}\n/ms', $sc, $m6 );
preg_match( '/^function visible\(.*?^}\n/ms', $sc, $m7 );
leak_ok( $m1 && $m2 && $m3 && $m4 && $m5 && $m6 && $m7, 'found the Support Centre release-range and search code in its snippet' );
if ( ! ( $m1 && $m2 && $m3 && $m4 && $m5 && $m6 && $m7 ) ) {
	exit( 1 );
}
eval( $ns_src . $m1[0] . $m2[0] . $m3[0] . $m4[0] . $m5[0] . $m6[0] . $m7[0] );
$vis = array_column( \AngieSnippets\PhSupportCentre_10156\visible(), 'cid' );
leak_ok( $vis === array( 'pub' ), 'Support Centre visible(): only the in-range article (' . implode( ',', $vis ) . ')' );

/* The Support Centre's own public routes must read only visible() and name no internal field. */
foreach ( array( 'index', 'published' ) as $route ) {
	preg_match( "/register_rest_route\( 'ph-help\/v1', '\/$route', \[(.*?)\n\t\] \);/s", $sc, $mr );
	leak_ok( ! empty( $mr[1] ), "found ph-help/v1/$route" );
	$body = $mr[1] ?? '';
	leak_ok( strpos( $body, 'visible()' ) !== false && strpos( $body, "catalogue()['arts']" ) === false, "ph-help/v1/$route reads only visible() (in-range, published) articles" );
	foreach ( array( 'programme', 'project', 'pendingRevision', "post_password", 'post_status', 'ph_help_' ) as $bad ) {
		leak_ok( stripos( $body, $bad ) === false, "ph-help/v1/$route names an internal field: $bad" );
	}
}
preg_match( "/register_rest_route\( 'ph-help\/v1', '\/index'.*?\n\t\] \);/s", $sc, $mi );
preg_match( '/\$out\[\]\s*=\s*\[(.*?)\];/s', $mi[0] ?? '', $mk );
preg_match_all( "/'(\w+)'\s*=>/", $mk[1] ?? '', $keys );
leak_ok( $keys[1] === array( 't', 'u', 'c', 's', 'k', 'q', 'o' ), 'ph-help/v1/index emits only t,u,c,s,k,q,o (' . implode( ',', $keys[1] ) . ')' );

/* ---- the snippet under test ---- */
require $dir . '/main.php';
require_once $dir . '/lib.php';

/* llms.txt */
$llms = $GLOBALS['hooks']['ph_llms_txt'][0]( "# Personalisation Hub\n\n> Intro.\n" );
clean( 'llms.txt', $llms );
leak_ok( strpos( $llms, 'Digital Signage' ) !== false, 'llms.txt still lists the good page (the seed is not just hiding everything)' );

/* JSON-LD, the alternate link and the markdown twin, for every seeded page */
foreach ( array_keys( $GLOBALS['posts'] ) as $id ) {
	$GLOBALS['q'] = $id;
	ob_start();
	$GLOBALS['hooks']['wp_head'][0]();
	$head = ob_get_clean();
	ob_start();
	$GLOBALS['hooks']['wp_footer'][0]();
	$foot = ob_get_clean();
	if ( 7020 === $id ) {
		leak_ok( strpos( $head, 'application/ld+json' ) !== false, 'good page gets JSON-LD' );
		clean( 'JSON-LD / head of 7020', $head );
		clean( 'WebMCP loader on 7020', $foot );
		clean( 'markdown twin of 7020', \AngieSnippets\PhAgentEndpoint___ID__\twin_for( $GLOBALS['posts'][7020] ) );
	} else {
		leak_ok( $head === '', "JSON-LD / head output for non-exposable page $id is empty" );
		leak_ok( $foot === '', "WebMCP loader printed on non-exposable page $id" );
		leak_ok( \AngieSnippets\PhAgentEndpoint___ID__\exposable_post( $id ) === null, "page $id is not exposable (so no markdown twin)" );
		clean( "head of $id", $head );
	}
}

/* ph-agent/v1 tools list and every tool call */
$GLOBALS['hooks']['rest_api_init'][0]();
$list = $GLOBALS['routes']['ph-agent/v1/tools']['callback']();
clean( 'ph-agent/v1/tools', $list->d );
$call = $GLOBALS['routes']['ph-agent/v1/tools/(?P<name>[a-z_]{1,40})']['callback'];
class LReq implements ArrayAccess { public $p; function __construct( $p ) { $this->p = $p; } function get_param( $k ) { return $this->p[ $k ] ?? null; } function offsetGet( $k ): mixed { return $this->p[ $k ]; } function offsetExists( $k ): bool { return isset( $this->p[ $k ] ); } function offsetSet( $k, $v ): void {} function offsetUnset( $k ): void {} }
$slugs = \AngieSnippets\PhAgentEndpoint___ID__\feature_slugs();
$probes = array(
	array( 'describe_platform', '{}' ), array( 'list_industries', '{}' ), array( 'start_free_trial', '{}' ), array( 'book_demo', '{}' ),
	array( 'get_industry', '{"slug":"lindt"}' ), array( 'get_industry', '{"slug":"webdemo"}' ),
	array( 'get_help_article', '{"url":"https://personalisationhub.com/support-centre/hq-admin/future/"}' ),
	array( 'get_help_article', '{"url":"https://personalisationhub.com/support-centre/hq-admin/gone/"}' ),
	array( 'get_help_article', '{"url":"https://personalisationhub.com/support-centre/hq-admin/pub/"}' ),
	array( 'get_help_article', '{"url":"https://personalisationhub.com/lindt-chocolate/"}' ),
);
foreach ( array( 'store', 'retired', 'feature', 'store feature' ) as $q ) { // never a marker itself: the query is echoed back
	$probes[] = array( 'search_help', json_encode( array( 'query' => $q ) ) );
}
foreach ( $slugs as $s ) {
	$probes[] = array( 'get_feature', json_encode( array( 'slug' => $s ) ) );
}
foreach ( array( 'lindt-chocolate', 'webdemo', 'aws-website-demo', 'mipharmacy', 'amazon-signage' ) as $s ) {
	$probes[] = array( 'get_feature', json_encode( array( 'slug' => $s ) ) );
}
foreach ( $probes as $pr ) {
	$res = $call( new LReq( array( 'name' => $pr[0], 'args' => $pr[1] ) ) );
	clean( "ph-agent/v1/tools/{$pr[0]} args={$pr[1]}", $res->d );
}
$ok = $call( new LReq( array( 'name' => 'search_help', 'args' => '{"query":"store"}' ) ) );
$txt = json_encode( $ok->d );
leak_ok( strpos( $txt, 'Add a store' ) !== false, 'search_help finds the published, in-range article (the seed is not just hiding everything)' );
$ok = $call( new LReq( array( 'name' => 'get_help_article', 'args' => '{"url":"https://personalisationhub.com/support-centre/hq-admin/future/"}' ) ) );
leak_ok( ! empty( $ok->d['isError'] ), 'get_help_article for an out-of-range article is an error, not its text' );
$ok = $call( new LReq( array( 'name' => 'get_feature', 'args' => '{"slug":"digital-signage"}' ) ) );
leak_ok( empty( $ok->d['isError'] ) && strpos( json_encode( $ok->d ), 'Digital Signage' ) !== false, 'get_feature returns the good page' );
foreach ( array( 'store-sites', 'personalisation' ) as $s ) {
	$ok = $call( new LReq( array( 'name' => 'get_feature', 'args' => json_encode( array( 'slug' => $s ) ) ) ) );
	leak_ok( ! empty( $ok->d['isError'] ), "get_feature $s (draft or password-protected) is an error" );
}

fwrite( STDOUT, $fails ? "ph-website leak: $fails of $n checks FAILED\n" : "ph-website leak: all $n checks passed\n" );
exit( $fails ? 1 : 0 );
