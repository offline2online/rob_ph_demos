<?php
/**
 * Offline tests for ph-website snippets. No WordPress, no network:
 *   php ph-website/tests/run.php
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

$dir = dirname( __DIR__ ) . '/snippets/ph-agent-endpoint';
require $dir . '/lib.php';
use function AngieSnippets\PhAgentEndpoint___ID__\{go_target,go_via,tracked_url,cta_event,referrer_host,allow_list,is_exposable,graph_for,json_ld,organization_node,software_node,html_to_markdown,markdown_twin,llms_sections,twin_url,page_url};

/* allow-list: only the agreed pages, none of the demo/campaign ones */
$paths = array_column( allow_list(), 0 );
foreach ( array( '/lindt-chocolate/', '/webdemo/', '/aws-website-demo/', '/mipharmacy/', '/amazon-signage/', '/australian-pork/', '/lego-comp/', '/coca-cola-offer/', '/blog-legacy/', '/grocery/' ) as $bad ) {
	ok( ! in_array( $bad, $paths, true ), "allow-list must not contain $bad" );
}
ok( count( allow_list() ) === 12, 'home + 8 features + 3 legal' );
ok( in_array( '/', $paths, true ) && in_array( '/privacy-policy/', $paths, true ), 'home and legal listed' );

/* exposure rules */
$base = array( 'id' => 7020, 'type' => 'page', 'status' => 'publish', 'password' => '', 'noindex' => false );
ok( is_exposable( $base ), 'published allow-listed page is exposable' );
foreach ( array( 'draft', 'future', 'private', 'pending', 'trash' ) as $st ) {
	ok( ! is_exposable( array_merge( $base, array( 'status' => $st ) ) ), "$st is not exposable" );
}
ok( ! is_exposable( array_merge( $base, array( 'password' => 'x' ) ) ), 'password-protected is not exposable' );
ok( ! is_exposable( array_merge( $base, array( 'noindex' => true ) ) ), 'noindex is not exposable' );
ok( ! is_exposable( array_merge( $base, array( 'id' => 99999 ) ) ), 'non-allow-listed id is not exposable' );
ok( ! is_exposable( array_merge( $base, array( 'type' => 'post' ) ) ), 'posts are not ours' );

/* JSON-LD */
$g = graph_for( 7020, 'Digital Signage', 'Desc "q" </script>' );
$j = json_ld( $g );
$d = json_decode( $j, true );
ok( is_array( $d ) && $d['@context'] === 'https://schema.org', 'json-ld decodes' );
ok( stripos( $j, '</script' ) === false, 'json-ld cannot close the script tag' );
$types = array_column( $d['@graph'], '@type' );
foreach ( array( 'Organization', 'SoftwareApplication', 'WebPage', 'BreadcrumbList' ) as $t ) {
	ok( in_array( $t, $types, true ), "graph has $t" );
}
$ids = array_column( $d['@graph'], '@id' );
ok( count( $ids ) === count( array_unique( $ids ) ), 'each @id declared once' );
ok( in_array( 'https://personalisationhub.com/#organization', $ids, true ) && in_array( 'https://personalisationhub.com/#software', $ids, true ), 'shared ids' );
ok( ! in_array( 'https://personalisationhub.com/#org', $ids, true ), 'no #org' );
$g2 = graph_for( 2389, 'Home', 'x' );
ok( $g2['@graph'][0] === $g['@graph'][0] && $g2['@graph'][1] === $g['@graph'][1], 'org and software identical across pages' );
ok( $g['@graph'][0] === organization_node() && $g['@graph'][1] === software_node(), 'nodes come from the one source' );
$offer = software_node()['offers'];
ok( $offer['url'] === 'https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76' && $offer['price'] === '0', 'AWS free trial offer' );
ok( count( graph_for( 2389, 'Home', '' )['@graph'][3]['itemListElement'] ) === 1, 'home breadcrumb is one item' );
ok( count( $g['@graph'][3]['itemListElement'] ) === 2, 'feature breadcrumb is two items' );

/* markdown */
$html = '<header><nav><a href="/x">Menu</a></nav></header><h1>Digital Signage</h1><p>Run <strong>screens</strong> with <a href="/personalisation/">personalisation</a>.</p>'
	. '<script>alert(1)</script><style>.a{}</style><form><input name="e"><button>Send</button></form><ul><li>One</li><li>Two <em>x</em></li></ul>'
	. '<div><div><h2>Why</h2><p>Because.</p></div></div><footer><p>Copyright</p></footer><a href="javascript:evil()">bad</a>';
$md = markdown_twin( 'Digital Signage', 'Summary line.', 'https://personalisationhub.com/digital-signage/', $html );
ok( strpos( $md, '# Digital Signage' ) === 0, 'twin starts with title' );
ok( substr_count( $md, '# Digital Signage' ) === 1, 'title not duplicated by page H1' );
ok( strpos( $md, '> Summary line.' ) !== false, 'summary present' );
ok( strpos( $md, '[personalisation](/personalisation/)' ) !== false && strpos( $md, '**screens**' ) !== false, 'inline markup' );
ok( strpos( $md, "- One\n- Two *x*" ) !== false, 'list' );
ok( strpos( $md, '## Why' ) !== false && strpos( $md, 'Because.' ) !== false, 'nested headings and paragraphs' );
foreach ( array( 'alert', '.a{}', 'Menu', 'Send', 'Copyright', 'javascript:', '<' ) as $bad ) {
	ok( strpos( $md, $bad ) === false, "twin omits: $bad" );
}
ok( html_to_markdown( '' ) === '', 'empty html' );

/* llms.txt */
$existing = "# Personalisation Hub\n\n> Intro.\n\n## Industries\n\n- [Retail](https://personalisationhub.com/industries/retail/?format=md)\n\n## Platform\n\n- [Digital signage](https://personalisationhub.com/digital-signage/)\n- [Store sites](/store-sites/)\n\n## Blog\n\n- [Blog](https://personalisationhub.com/blog/?format=md)\n\n## Support Centre\n\n- [Support](https://personalisationhub.com/support-centre/?format=md)\n";
$pages = array();
foreach ( allow_list() as $id => $r ) {
	$pages[ $id ] = array( 'Page ' . $id, 'Summary ' . $id );
}
unset( $pages[3973] ); // e.g. a draft: filtered out by the caller
$out = llms_sections( $existing, $pages );
ok( strpos( $out, $existing ) !== false || strpos( $out, '## Industries' ) !== false, 'existing sections kept' );
ok( strpos( $out, '(https://personalisationhub.com/digital-signage/?format=md)' ) !== false, 'platform links point at twins' );
ok( strpos( $out, '(https://personalisationhub.com/store-sites/?format=md)' ) !== false || strpos( $out, '(/store-sites/?format=md)' ) !== false, 'relative platform link rewritten' );
ok( substr_count( $out, '## Platform' ) === 1, 'platform section not duplicated' );
foreach ( array( 'Company', 'For AI agents' ) as $h ) {
	ok( substr_count( $out, "## $h" ) === 1, "## $h added once" );
}
ok( strpos( $out, 'privacy-policy/?format=md' ) !== false && strpos( $out, '/legal/?format=md' ) !== false && strpos( $out, '/support/?format=md' ) !== false, 'legal pages listed' );
ok( strpos( $out, '(https://personalisationhub.com/mcp)' ) !== false && strpos( $out, 'WebMCP' ) !== false, 'agents section lists MCP (on personalisationhub.com) and WebMCP' );
ok( ! preg_match( '#backlog-tracker|\.web\.app|firebaseapp\.com|cloudfunctions\.net#i', $out ), 'llms.txt sections never name the console host' );
ok( strpos( $out, 'localisation-geo-targeting' ) === false, 'unpublished page is not listed' );
ok( llms_sections( $out, $pages ) === $out || substr_count( llms_sections( $out, $pages ), '## For AI agents' ) === 1, 'idempotent sections' );
foreach ( array( 'lindt', 'webdemo', 'mipharmacy', 'amazon-signage' ) as $bad ) {
	ok( stripos( $out, $bad ) === false, "llms.txt omits $bad" );
}
$fresh = llms_sections( "# PH\n", $pages );
ok( strpos( $fresh, '## Platform' ) !== false && strpos( $fresh, '(https://personalisationhub.com/?format=md)' ) !== false, 'platform built when absent, including home' );

/* WordPress glue against stubs */
define( 'ABSPATH', '/' );
$GLOBALS['hooks'] = array();
function add_action( $h, $f, $p = 10 ) { $GLOBALS['hooks'][ $h ][] = $f; }
function add_filter( $h, $f, $p = 10 ) { $GLOBALS['hooks'][ $h ][] = $f; }
$GLOBALS['posts'] = array(
	7020 => (object) array( 'ID' => 7020, 'post_type' => 'page', 'post_status' => 'publish', 'post_password' => '', 'post_title' => 'Digital Signage', 'post_excerpt' => 'Sig', 'post_modified_gmt' => 'x', 'post_content' => '<h1>' . 'T' . '</h1><p>Body</p>' ),
	3477 => (object) array( 'ID' => 3477, 'post_type' => 'page', 'post_status' => 'draft', 'post_password' => '', 'post_title' => 'Store Sites', 'post_excerpt' => '', 'post_modified_gmt' => 'x', 'post_content' => '<h1>' . 'T' . '</h1><p>Body</p>' ),
	3566 => (object) array( 'ID' => 3566, 'post_type' => 'page', 'post_status' => 'publish', 'post_password' => 'pw', 'post_title' => 'Personalisation', 'post_excerpt' => '', 'post_modified_gmt' => 'x', 'post_content' => '<h1>' . 'T' . '</h1><p>Body</p>' ),
	555  => (object) array( 'ID' => 555, 'post_type' => 'page', 'post_status' => 'publish', 'post_password' => '', 'post_title' => 'Lindt Chocolate', 'post_excerpt' => '', 'post_modified_gmt' => 'x', 'post_content' => '<h1>' . 'T' . '</h1><p>Body</p>' ),
);
function get_post( $id ) { return $GLOBALS['posts'][ (int) $id ] ?? null; }
function get_post_meta( $id, $k, $s = true ) { return ''; }
function wp_strip_all_tags( $s ) { return strip_tags( (string) $s ); }
function get_the_title( $p ) { return $p->post_title; }
function is_singular() { return true; }
function get_queried_object_id() { return $GLOBALS['q'] ?? 0; }
function esc_url( $u ) { return $u; }
function delete_transient() {}
require $dir . '/main.php';
ok( ! empty( $GLOBALS['hooks']['ph_llms_txt'] ) && ! empty( $GLOBALS['hooks']['wp_head'] ) && ! empty( $GLOBALS['hooks']['template_redirect'] ), 'snippet registers its hooks' );
$llms = $GLOBALS['hooks']['ph_llms_txt'][0]( "# PH\n" );
ok( strpos( $llms, 'Digital Signage' ) !== false, 'published page listed through the filter' );
ok( strpos( $llms, 'Store Sites' ) === false && strpos( $llms, 'Personalisation](' ) === false, 'draft and protected pages absent through the filter' );
ok( strpos( $llms, 'Lindt' ) === false, 'non-allow-listed page absent' );
ob_start();
$GLOBALS['q'] = 7020;
$GLOBALS['hooks']['wp_head'][0]();
$head = ob_get_clean();
ok( strpos( $head, 'application/ld+json' ) !== false && strpos( $head, 'rel="alternate" type="text/markdown"' ) !== false, 'head gets JSON-LD and alternate link' );
foreach ( array( 3477, 3566, 555 ) as $id ) {
	ob_start();
	$GLOBALS['q'] = $id;
	$GLOBALS['hooks']['wp_head'][0]();
	ok( ob_get_clean() === '', "no JSON-LD or twin link for $id" );
}


/* ------------------------------------------------------------ tool contract */
/* the calculators list lives in the Industries snippet; the tool reads it from there (tests/calculators.test.php covers it in depth) */
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ );
}
require_once dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/calculators.php';
use function AngieSnippets\PhAgentEndpoint___ID__\{installation_spec,installation_spec_md,unconfirmed_paths,tool_defs,run_tool,validate_args,help_article_path,feature_slugs};
const SC_NS_T = 'AngieSnippets\PhSupportCentre_10156';

$defs  = tool_defs();
$names = array_column( $defs, 'name' );
ok( $names === array( 'describe_platform', 'list_industries', 'get_industry', 'get_feature', 'search_help', 'get_help_article', 'start_free_trial', 'book_demo', 'get_installation_spec', 'calculate_business_model' ), 'exactly the ten tools, in order' );
foreach ( $defs as $d ) {
	ok( ! empty( $d['annotations']['readOnlyHint'] ) && isset( $d['inputSchema']['type'] ) && $d['description'] !== '', "{$d['name']} is read-only with a schema" );
}
ok( count( array_unique( feature_slugs() ) ) === 8 && in_array( 'ai-agents', feature_slugs(), true ), 'eight feature slugs from the allow-list' );
ok( strpos( json_encode( $defs ), '"properties":{}' ) !== false, 'no-arg tools encode properties as an object' );

/* the Support Centre's own search, extracted from its snippet source and run unchanged */
$sc  = file_get_contents( dirname( __DIR__ ) . '/snippets/ph-support-centre/main.php' );
preg_match( '/^const STOPWORDS = .*?;$/ms', $sc, $m1 );
preg_match( '/^function search_terms\(.*?^}\n/ms', $sc, $m2 );
preg_match( '/^function search_articles\(.*?^}\n/ms', $sc, $m3 );
ok( $m1 && $m2 && $m3, 'found the Support Centre search in its snippet' );
eval( 'namespace AngieSnippets\PhSupportCentre_10156; ' . $m1[0] . $m2[0] . $m3[0] );
$arts = array(
	array( 'title' => 'Add a store', 'summary' => 'Create a store record', 'kw' => array( 'stores' ), 'q' => array( 'How do I add a store?' ), 'order' => 2, 'cat' => 1, 'slug' => 'add-a-store' ),
	array( 'title' => 'Store opening hours', 'summary' => 'Set hours for a store', 'kw' => array(), 'q' => array(), 'order' => 1, 'cat' => 1, 'slug' => 'store-hours' ),
	array( 'title' => 'Order a display', 'summary' => 'Add a display to a store', 'kw' => array(), 'q' => array(), 'order' => 3, 'cat' => 1, 'slug' => 'order-display' ),
);
$siteHits = \AngieSnippets\PhSupportCentre_10156\search_articles( $arts, 'How do I add a store?' );
ok( $siteHits[0]['title'] === 'Add a store', 'site search puts "Add a store" first' );

/* fake live source */
$pagesLive = array( 2389 => array( 'Home', 'Run every screen.' ), 7020 => array( 'Digital Signage', 'Screens.' ), 3477 => array( 'Store Sites', '' ) );
$src = array(
	'pages'       => function () use ( $pagesLive ) { return $pagesLive; },
	'page_md'     => function ( $id ) use ( $pagesLive ) { return isset( $pagesLive[ $id ] ) ? '# ' . $pagesLive[ $id ][0] . "\n" : null; },
	'industries'  => function () { return array( array( 'retail-media', 'Retail Media', 'https://personalisationhub.com/industries/retail-media/', 'Sell media.' ) ); },
	'industry_md' => function ( $s ) { return 'retail-media' === $s ? "# Retail Media\n" : null; },
	'search'      => function ( $q, $limit ) use ( $arts ) {
		$out = array();
		foreach ( array_slice( \AngieSnippets\PhSupportCentre_10156\search_articles( $arts, $q ), 0, $limit ) as $a ) {
			$out[] = array( $a['title'], 'https://personalisationhub.com/support-centre/x/' . $a['slug'] . '/', 'Setup', '', $a['summary'] );
		}
		return $out;
	},
	'article_md'  => function ( $p ) { return '/support-centre/x/add-a-store/' === $p ? "# Add a store\n" : null; },
);
$r = run_tool( 'search_help', array( 'query' => 'How do I add a store?' ), $src );
ok( empty( $r['isError'] ) && $r['structuredContent']['results'][0]['title'] === 'Add a store', 'search_help returns "Add a store" first, as the site search does' );
ok( count( run_tool( 'search_help', array( 'query' => 'store', 'limit' => 2 ), $src )['structuredContent']['results'] ) === 2, 'search_help honours limit' );
ok( strpos( json_encode( $r ), 'ph_help_' ) === false && strpos( json_encode( $r ), '"cid"' ) === false, 'search results carry no internal fields' );
ok( ! empty( run_tool( 'search_help', array( 'query' => 'x', 'limit' => 999 ), $src )['isError'] ), 'limit 999 is an error' );
ok( ! empty( run_tool( 'search_help', array( 'query' => '' ), $src )['isError'] ) && ! empty( run_tool( 'search_help', array(), $src )['isError'] ), 'empty or missing query is an error' );
ok( ! empty( run_tool( 'search_help', array( 'query' => 'x', 'extra' => 1 ), $src )['isError'] ), 'unknown argument is an error' );
ok( ! empty( run_tool( 'search_help', array( 'query' => 'x', 'limit' => '3' ), $src )['isError'] ), 'limit must be an integer' );
ok( ! empty( run_tool( 'search_help', 'nope', $src )['isError'] ), 'non-object args are an error' );
ok( ! empty( run_tool( 'nope', array(), $src )['isError'] ), 'unknown tool is an error' );
ok( ! empty( run_tool( 'get_industry', array( 'slug' => 'lindt' ), $src )['isError'] ) && ! empty( run_tool( 'get_feature', array( 'slug' => 'webdemo' ), $src )['isError'] ), 'unknown slugs are errors' );
ok( empty( run_tool( 'get_feature', array( 'slug' => 'digital-signage' ), $src )['isError'] ), 'get_feature works for a feature slug' );
ok( ! empty( run_tool( 'get_feature', array( 'slug' => 'localisation-geo-targeting' ), $src )['isError'] ), 'a feature that is not exposable is an error, not an empty page' );
ok( empty( run_tool( 'get_industry', array( 'slug' => 'retail-media' ), $src )['isError'] ) && ! empty( run_tool( 'get_industry', array( 'slug' => 'grocery' ), $src )['isError'] ), 'get_industry only for live industries' );
$li = run_tool( 'list_industries', array(), $src );
ok( $li['structuredContent']['industries'][0]['slug'] === 'retail-media', 'list_industries returns the live ones' );
$dp = run_tool( 'describe_platform', array(), $src );
ok( strpos( $dp['content'][0]['text'], '[Digital Signage](https://personalisationhub.com/digital-signage/)' ) !== false && strpos( $dp['content'][0]['text'], 'Localisation' ) === false, 'describe_platform lists only exposable product areas' );
ok( run_tool( 'start_free_trial', array(), $src )['structuredContent']['url'] === 'https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76', 'exact free trial link' );
ok( run_tool( 'book_demo', array(), $src )['structuredContent']['url'] === 'https://calendly.com/rob-offline2online', 'exact demo link' );
ok( ! empty( run_tool( 'start_free_trial', array( 'a' => 1 ), $src )['isError'] ), 'no-arg tools refuse arguments' );
/* RevOps (ticket 5): tracked hop keeps the exact link, fixed targets, no personal data */
$ft = run_tool( 'start_free_trial', array(), $src )['structuredContent'];
ok( $ft['trackedUrl'] === 'https://personalisationhub.com/go/free-trial/?via=webmcp', 'free trial trackedUrl' );
ok( run_tool( 'book_demo', array(), $src )['structuredContent']['trackedUrl'] === 'https://personalisationhub.com/go/demo/?via=webmcp', 'demo trackedUrl' );
ok( go_target( '/go/free-trial/?via=webmcp' ) === array( 'free-trial', 'https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76' ), 'hop leads to the exact trial link' );
ok( go_target( '/go/demo' )[1] === 'https://calendly.com/rob-offline2online', 'hop leads to the exact demo link' );
foreach ( array( '/go/', '/go/evil/', '/go/demo/../x', '/go//evil.example/', '/go/https://evil.example', '/other/demo/', '/go/demo/extra/' ) as $bad ) {
	ok( go_target( $bad ) === null, "no hop for $bad" );
}
ok( go_via( 'remote-mcp' ) === 'remote-mcp' && go_via( 'webmcp' ) === 'webmcp' && go_via( 'https://evil' ) === 'agent' && go_via( '' ) === 'agent', 'via is allow-listed' );
$ev = cta_event( 'demo', 'remote-mcp', 'https://agent.example/chat?email=a@b.c#x', 1700000000 );
ok( $ev['agent'] === true && $ev['event'] === 'ph_agent_cta' && $ev['referrer'] === 'agent.example' && $ev['source'] === 'remote-mcp', 'agent CTA event flagged, referrer is a host' );
ok( array_keys( $ev ) === array( 'event', 'cta', 'source', 'agent', 'referrer', 'at' ) && strpos( json_encode( $ev ), '@' ) === false, 'CTA event holds no IP, email or free text' );
ok( referrer_host( 'javascript:alert(1)' ) === null && referrer_host( '' ) === null, 'bad referrer is none' );
ok( run_tool( 'get_help_article', array( 'url' => 'https://personalisationhub.com/support-centre/x/add-a-store/' ), $src )['content'][0]['text'] === "# Add a store\n", 'get_help_article returns the markdown' );
ok( run_tool( 'get_help_article', array( 'url' => '/support-centre/x/add-a-store' ), $src )['content'][0]['text'] === "# Add a store\n", 'path form works' );
foreach ( array( 'https://personalisationhub.com/digital-signage/', 'https://evil.example/support-centre/x/add-a-store/', 'https://personalisationhub.com/support-centre/../wp-admin/', 'https://personalisationhub.com/support-centre/%2e%2e/x/', '/support-centre/', 'https://personalisationhub.com.evil.example/support-centre/a/', 'javascript:alert(1)', 'ftp://personalisationhub.com/support-centre/a/', "/support-centre/a\n/b/", 'https://user@personalisationhub.com/support-centre/a/' ) as $u ) {
	ok( help_article_path( $u ) === null && ! empty( run_tool( 'get_help_article', array( 'url' => $u ), $src )['isError'] ), "refused: $u" );
}
ok( ! empty( run_tool( 'get_help_article', array( 'url' => 'https://personalisationhub.com/support-centre/x/none/' ), $src )['isError'] ), 'unknown article is an error' );
$throws = array_merge( $src, array( 'pages' => function () { throw new Exception( 'secret path /var/www' ); } ) );
$te = run_tool( 'describe_platform', array(), $throws );
ok( ! empty( $te['isError'] ) && strpos( json_encode( $te ), 'secret' ) === false, 'a failure becomes a plain isError, never a PHP error' );
foreach ( $defs as $d ) {
	$all = json_encode( array( $d, run_tool( $d['name'], array(), $src ) ) );
	foreach ( array( 'lindt', 'mipharmacy', 'amazon-signage', 'australian-pork', 'coca-cola', 'webdemo' ) as $bad ) {
		ok( stripos( $all, $bad ) === false, "{$d['name']} output omits $bad" );
	}
}

/* REST glue against stubs: routes, allow-list through the source, cache flush, loader */
$GLOBALS['routes'] = array();
function register_rest_route( $ns, $route, $a ) { $GLOBALS['routes'][ $ns . $route ] = $a; }
function rest_ensure_response( $d ) { return new class( $d ) { public $d; public $h = array(); function __construct( $d ) { $this->d = $d; } function header( $k, $v ) { $this->h[ $k ] = $v; } function set_status( $c ) { $this->status = $c; } public $status = 200; }; }
function wp_salt() { return 'test-salt'; }
function get_option( $k, $d = false ) { return $GLOBALS['opts'][ $k ] ?? $d; }
function update_option( $k, $v ) { $GLOBALS['opts'][ $k ] = $v; }
function get_transient( $k ) { return $GLOBALS['tr'][ $k ] ?? false; }
function set_transient( $k, $v ) { $GLOBALS['tr'][ $k ] = $v; }
function wp_json_encode( $v ) { return json_encode( $v, JSON_UNESCAPED_SLASHES ); }
function rest_url( $p = '' ) { return 'https://personalisationhub.com/wp-json/' . $p; }
function get_page_by_path( $p ) { return $GLOBALS['byPath'][ $p ] ?? null; }
function get_page_uri( $p ) { return $p->uri ?? ''; }
function home_url( $p = '' ) { return 'https://personalisationhub.com' . $p; }
function apply_filters( $h, $v ) { return $v; }
function is_admin() { return false; }
function is_feed() { return false; }
function is_404() { return false; }
function is_tax() { return false; }
function get_queried_object() { return $GLOBALS['posts'][ $GLOBALS['q'] ] ?? null; }
function __return_true() { return true; }
$GLOBALS['opts'] = array();
$GLOBALS['tr']   = array();
$GLOBALS['byPath'] = array();
$GLOBALS['hooks']['rest_api_init'][0]();
ok( isset( $GLOBALS['routes']['ph-agent/v1/tools'], $GLOBALS['routes']['ph-agent/v1/tools/(?P<name>[a-z_]{1,40})'] ), 'both routes registered' );
$list = $GLOBALS['routes']['ph-agent/v1/tools']['callback']();
ok( count( $list->d['tools'] ) === 10 && $list->h['Cache-Control'] === 'public, max-age=300', 'list: ten tools, cacheable five minutes' );
ok( $GLOBALS['routes']['ph-agent/v1/tools']['permission_callback']() === true, 'public read-only' );
$call = $GLOBALS['routes']['ph-agent/v1/tools/(?P<name>[a-z_]{1,40})']['callback'];
class Req implements ArrayAccess { public $p; function __construct( $p ) { $this->p = $p; } function get_param( $k ) { return $this->p[ $k ] ?? null; } function offsetGet( $k ): mixed { return $this->p[ $k ]; } function offsetExists( $k ): bool { return isset( $this->p[ $k ] ); } function offsetSet( $k, $v ): void {} function offsetUnset( $k ): void {} }
$res = $call( new Req( array( 'name' => 'get_feature', 'args' => '{"slug":"digital-signage"}' ) ) );
ok( empty( $res->d['isError'] ) && strpos( $res->d['content'][0]['text'], '# Digital Signage' ) !== false, 'endpoint serves the published allow-listed feature page' );
ok( $res->h['Cache-Control'] === 'public, max-age=300', 'success is cacheable' );
$n1 = count( $GLOBALS['tr'] );
$call( new Req( array( 'name' => 'get_feature', 'args' => '{"slug":"digital-signage"}' ) ) );
ok( count( $GLOBALS['tr'] ) === $n1, 'second identical call is a cache hit' );
$bad = $call( new Req( array( 'name' => 'get_feature', 'args' => '{"slug":"store-sites"}' ) ) );
ok( ! empty( $bad->d['isError'] ) && $bad->h['Cache-Control'] === 'no-store', 'draft page: isError, not cached' );
$bad = $call( new Req( array( 'name' => 'get_feature', 'args' => '{"slug":"personalisation"}' ) ) );
ok( ! empty( $bad->d['isError'] ), 'password-protected page: isError' );
foreach ( array( '{bad', '[1]', '"x"', str_repeat( 'a', 2001 ) ) as $badArgs ) {
	$x = $call( new Req( array( 'name' => 'book_demo', 'args' => $badArgs ) ) );
	ok( ! empty( $x->d['isError'] ), 'bad args JSON is an isError: ' . substr( $badArgs, 0, 8 ) );
}
ok( empty( $call( new Req( array( 'name' => 'book_demo' ) ) )->d['isError'] ), 'no args means empty object' );
ok( ! empty( $call( new Req( array( 'name' => 'drop_tables', 'args' => '{}' ) ) )->d['isError'] ), 'unknown tool over REST is isError' );
$x = $call( new Req( array( 'name' => 'search_help', 'args' => '{"query":"store"}' ) ) );
ok( ! empty( $x->d['isError'] ), 'search_help is isError (not a crash) when the Support Centre snippet is absent' );
$g0 = $GLOBALS['opts']['ph_ae_gen'] ?? 1;
$GLOBALS['hooks']['save_post'][0]( 7020, $GLOBALS['posts'][7020] );
ok( ( $GLOBALS['opts']['ph_ae_gen'] ?? 1 ) === $g0 + 1, 'saving an allow-listed page starts a new cache generation' );
$GLOBALS['hooks']['save_post'][0]( 555, $GLOBALS['posts'][555] );
ok( ( $GLOBALS['opts']['ph_ae_gen'] ?? 1 ) === $g0 + 1, 'saving a demo page does not' );
$GLOBALS['hooks']['save_post'][0]( 9, (object) array( 'ID' => 9, 'post_type' => 'ph_help_article' ) );
ok( ( $GLOBALS['opts']['ph_ae_gen'] ?? 1 ) === $g0 + 2, 'saving a help article does' );

/* Pen test fixes (PT-02, PT-04, PT-05): rate limit, stable cache key, sanitised errors, CORS filter */
use function AngieSnippets\PhAgentEndpoint___ID__\{rate_wait,args_key,rate_hit,tool_def};
ok( rate_wait( 120, 120, 30 ) === 0 && rate_wait( 121, 120, 30 ) === 30 && rate_wait( 500, 120, 0 ) === 1, 'rate_wait: at the limit passes, over it waits at least 1 s' );
ok( args_key( array( 'b' => 2, 'a' => 1 ) ) === args_key( array( 'a' => 1, 'b' => 2 ) ), 'cache key ignores argument order' );
$ua = validate_args( tool_def( 'search_help' )['inputSchema'], array( 'query' => 'x', '<script>alert(1)</script>' => 1 ) );
ok( strpos( $ua, '<' ) === false && strpos( $ua, '(' ) === false, 'unknown-argument error does not echo markup' );
$_SERVER['REMOTE_ADDR'] = '203.0.113.5';
$GLOBALS['tr'] = array();
$last = 0;
for ( $i = 0; $i < 31; $i++ ) {
	$last = rate_hit( 'cta', 30 );
}
ok( $last >= 1, 'the 31st CTA hop in a minute is over the limit' );
$_SERVER['REMOTE_ADDR'] = '203.0.113.6';
ok( rate_hit( 'cta', 30 ) === 0, 'another address has its own budget' );
$GLOBALS['tr'] = array();
$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
for ( $i = 0; $i < 120; $i++ ) {
	$call( new Req( array( 'name' => 'book_demo' ) ) );
}
$lim = $call( new Req( array( 'name' => 'book_demo' ) ) );
ok( $lim->status === 429 && isset( $lim->h['Retry-After'] ) && $lim->h['Cache-Control'] === 'no-store' && ! empty( $lim->d['isError'] ), 'tool route answers 429 with Retry-After and no-store after 120 calls' );
ok( strpos( json_encode( $lim->d ), '203.0.113' ) === false, '429 body does not echo the address' );
ok( isset( $GLOBALS['hooks']['rest_pre_serve_request'] ), 'CORS/nosniff filter registered for the agent routes' );

/* the loader: printed only on exposable allow-listed pages, inline and small */
$js = file_get_contents( $dir . '/webmcp.js' );
ok( strlen( $js ) < 2048, 'loader under 2 KB (' . strlen( $js ) . ' bytes)' );
ok( strpos( $js, 'navigator.modelContext' ) !== false && strpos( $js, 'src=' ) === false, 'loader checks modelContext' );
$GLOBALS['q'] = 7020;
ob_start();
$GLOBALS['hooks']['wp_footer'][0]();
$foot = ob_get_clean();
ok( strpos( $foot, '<script>window.PH_AE_REST="https://personalisationhub.com/wp-json/ph-agent/v1/"' ) === 0 && strpos( $foot, ' src=' ) === false, 'allow-listed page prints the loader inline, no extra request' );
foreach ( array( 3477, 3566, 555 ) as $id ) {
	$GLOBALS['q'] = $id;
	ob_start();
	$GLOBALS['hooks']['wp_footer'][0]();
	ok( ob_get_clean() === '', "no loader on $id (draft, protected or demo page)" );
}

/* One shared Organization and SoftwareApplication on every page (Home, Blog, Support Centre, Industries) */
$snips = dirname( __DIR__ ) . '/snippets';
$org   = $snips . '/ph-agent-endpoint/lib.php';
$nodes = array(
	'home' => array( organization_node(), software_node() ),
);
foreach ( array( 'blog' => array( 'ph-blog', 'AngieSnippets\PhBlog_10116' ), 'support-centre' => array( 'ph-support-centre', 'AngieSnippets\PhSupportCentre_10156' ) ) as $key => $def ) {
	$src = file_get_contents( $snips . '/' . $def[0] . '/main.php' );
	ok( preg_match( '/^function org\(\) \{.*?^\}\n/ms', $src, $mo ) && preg_match( '/^function software\(\) \{.*?^\}\n/ms', $src, $ms ), "$key defines org() and software()" );
	eval( 'namespace ' . $def[1] . '; ' . $mo[0] . $ms[0] );
	$nodes[ $key ] = array( call_user_func( '\\' . $def[1] . '\\org' ), call_user_func( '\\' . $def[1] . '\\software' ) );
	ok( strpos( $src, "/#org'" ) === false && strpos( $src, '/#org"' ) === false, "$key has no #org" );
	/* every graph that includes the organization includes the software application beside it */
	$calls_org = preg_match_all( '/(?<!function )\borg\(\)/', $src );
	$calls_sw  = preg_match_all( '/(?<!function )\bsoftware\(\)/', $src );
	ok( $calls_org >= 2 && $calls_org === $calls_sw, "$key prints org() and software() in every graph" );
}
$ind = include $snips . '/ph-industry-enhancements/ld.php';
ok( count( $ind ) === 10, 'ten industry graphs' );
foreach ( $ind as $slug => $json ) {
	$g = json_decode( $json, true );
	ok( is_array( $g ), "industry $slug decodes" );
	$nodes[ 'industry-' . $slug ] = array( $g['@graph'][0], $g['@graph'][1] );
	$gids = array_column( $g['@graph'], '@id' );
	ok( count( array_keys( $gids, 'https://personalisationhub.com/#organization', true ) ) === 1 && count( array_keys( $gids, 'https://personalisationhub.com/#software', true ) ) === 1, "industry $slug declares each shared id once" );
	ok( strpos( $json, '/#org"' ) === false, "industry $slug has no #org" );
}
foreach ( $nodes as $key => $pair ) {
	ok( $pair[0]['@id'] === 'https://personalisationhub.com/#organization', "$key organization id" );
	ok( $pair[1]['@id'] === 'https://personalisationhub.com/#software', "$key software id" );
	ok( json_encode( $pair[0] ) === json_encode( $nodes['home'][0] ), "$key Organization has the same properties as Home" );
	ok( json_encode( $pair[1] ) === json_encode( $nodes['home'][1] ), "$key SoftwareApplication has the same properties as Home" );
}
$allids = array();
foreach ( $nodes as $pair ) {
	$allids[ $pair[0]['@id'] ] = 1;
	$allids[ $pair[1]['@id'] ] = 1;
}
ok( count( $allids ) === 2, 'one Organization id and one SoftwareApplication id across all pages' );

/* Entity clarity: legal name, founding date, founder, logo and sameAs; no location anywhere in the schema */
$o = organization_node();
ok( $o['legalName'] === 'Personalisation Hub Pty Ltd' && $o['foundingDate'] === '2018' && $o['founder']['name'] === 'Rob Geerdink', 'Organization has legalName, foundingDate 2018 and founder' );
ok( strpos( $o['logo'], 'https://personalisationhub.com/' ) === 0, 'Organization has a logo' );
ok( count( $o['sameAs'] ) === 5 && in_array( 'https://www.linkedin.com/company/personalisation-hub/', $o['sameAs'], true ) && in_array( 'https://signage.amazon.com/cms-partners/personalisation-hub', $o['sameAs'], true ), 'Organization sameAs: LinkedIn, AWS Marketplace, Amazon Signage CMS, X, seller profile' );
$oj = json_encode( $o ) . json_encode( software_node() );
ok( ! preg_match( '/Sydney|Australia|crunchbase|g2\.com|address|2016/i', $oj ), 'no location, Crunchbase, G2 or 2016 in the entity schema' );
ok( $o['areaServed'] === 'Worldwide', 'Organization serves Worldwide (a scope, not a location)' );
ok( strpos( file_get_contents( $snips . '/ph-support-centre/main.php' ), "const SITE_NAME    = 'Personalisation Hub Support Centre'" ) !== false, 'Support Centre WebSite is named Support Centre' );

/* Support Centre 1.4.0: live feed first, refresh endpoint, no Google Fonts request */
$scs = file_get_contents( $snips . '/ph-support-centre/main.php' );
ok( strpos( $scs, "const VER          = '1.4.3'" ) !== false, 'Support Centre is 1.4.3' );
ok( strpos( $scs, '"- [Help search API](" . PUBLIC_HELP . "/search' ) !== false && strpos( $scs, '"- [Help MCP server](" . PUBLIC_MCP . ")' ) !== false, 'Support Centre llms.txt lines use the personalisationhub.com addresses' );
ok( strpos( $scs, "const PUBLIC_HELP  = 'https://personalisationhub.com/help-api'" ) !== false && strpos( $scs, "const PUBLIC_MCP   = 'https://personalisationhub.com/mcp'" ) !== false, 'Support Centre public help API and MCP addresses are on personalisationhub.com' );
ok( 1 === preg_match_all( '/\bHELP_API\b(?!_)/', preg_replace( '/^const HELP_API .*$/m', '', $scs ) ), 'HELP_API (the console) is used only for the server-side sync sources, never in public output' );
ok( preg_match( "/const SOURCES\\s*=\\s*\\[\\s*HELP_API \\. '\\/data\\/', 'https:\\/\\/raw\\.githubusercontent\\.com[^']*', 'https:\\/\\/help\\.personalisationhub\\.com\\/data\\/'/", $scs ) === 1, 'sources: live feed, GitHub raw, help site, in that order' );
ok( strpos( $scs, "const HELP_API     = 'https://backlog-tracker-e4ed2.web.app/help-api'" ) !== false, 'HELP_API is the live console feed' );
ok( strpos( $scs, "const SYNC_VER     = '2'" ) !== false, 'SYNC_VER unchanged' );
ok( strpos( $scs, 'fonts.googleapis.com' ) === false, 'no request to fonts.googleapis.com from the snippet' );
preg_match( '/function refresh_request\(\) \{.*?\n\}\n/s', $scs, $m );
$rf = $m[0] ?? '';
ok( $rf !== '', 'refresh_request exists' );
ok( strpos( $rf, 'sync(' ) === false && strpos( $rf, 'do_action' ) === false, 'refresh never calls the sync inline' );
ok( strpos( $rf, 'spawn_cron()' ) !== false && strpos( $rf, 'wp_schedule_single_event' ) < strpos( $rf, 'spawn_cron()' ), 'refresh calls spawn_cron() after scheduling the event (1.4.1)' );
ok( strpos( $rf, 'do_action( \'ph_sc_sync' ) === false && strpos( $rf, 'wp_cron(' ) === false && strpos( $rf, 'do_action_ref_array' ) === false, 'refresh still never runs the sync (spawn is a non-blocking loopback)' );
ok( strpos( $rf, 'wp_schedule_single_event( time(),' ) !== false && strpos( $rf, 'time() + 5' ) === false && strpos( $rf, "'ph_sc_sync'" ) !== false, 'refresh schedules one ph_sc_sync due now (1.4.2), so spawn_cron() finds it due' );
ok( strpos( $rf, '429' ) !== false && strpos( $rf, '202' ) !== false && strpos( $rf, 'retryAfter' ) !== false, 'refresh answers 202 or 429 with retryAfter' );
ok( strpos( $rf, 'get_transient( \'ph_sc_refresh\' )' ) !== false && strpos( $rf, 'set_transient( \'ph_sc_refresh\', time() + 60, 60 )' ) !== false, 'refresh is rate-limited to 60 s by a transient' );
ok( strpos( $rf, '$req' ) === false && strpos( $rf, '$_' ) === false && strpos( $rf, 'get_param' ) === false, 'refresh reads no input' );
/* Behaviour (1.4.2): run refresh_request() against stubbed WP functions. The event must be due when spawn_cron() runs; the sync is never called inline. */
{
	$GLOBALS['phsc'] = [ 'sched' => [], 'spawn' => [], 'inline' => 0, 'tr' => 0, 'next' => false ];
	$stubs = <<<'PHPSTUB'
namespace AngieSnippets\PhSupportCentre_10156;
function get_transient( $k ) { return $GLOBALS['phsc']['tr']; }
function set_transient( $k, $v, $e ) { $GLOBALS['phsc']['tr'] = $v; return true; }
function wp_next_scheduled( $h ) { return $GLOBALS['phsc']['next']; }
function wp_schedule_single_event( $t, $h ) { $GLOBALS['phsc']['sched'][] = $t; return true; }
function spawn_cron() { $g = &$GLOBALS['phsc']; $g['spawn'][] = array_map( fn( $t ) => $t <= time(), $g['sched'] ); return true; }
function sync() { $GLOBALS['phsc']['inline']++; }
class WPRR { public $d; public $s; public $h = []; function __construct( $d, $s ) { $this->d = $d; $this->s = $s; } function header( $k, $v ) { $this->h[ $k ] = $v; } }
PHPSTUB;
	$code  = $stubs . "\n" . str_replace( 'new \\WP_REST_Response', 'new WPRR', $rf );
	eval( $code );
	$r1 = \AngieSnippets\PhSupportCentre_10156\refresh_request();
	ok( $r1->s === 202 && count( $GLOBALS['phsc']['sched'] ) === 1, 'refresh: first ping answers 202 and schedules one event' );
	ok( $GLOBALS['phsc']['sched'][0] <= time(), 'refresh: the event timestamp is <= time() when spawn_cron() is called' );
	ok( $GLOBALS['phsc']['spawn'] === [ [ true ] ], 'refresh: spawn_cron() saw an already-due event' );
	ok( $GLOBALS['phsc']['inline'] === 0, 'refresh: sync() is never called inline' );
	$r2 = \AngieSnippets\PhSupportCentre_10156\refresh_request();
	ok( $r2->s === 429 && isset( $r2->h['Retry-After'] ) && count( $GLOBALS['phsc']['sched'] ) === 1, 'refresh: a second ping within 60 s answers 429 with Retry-After and schedules nothing' );
}
ok( preg_match( "/register_rest_route\\( 'ph-help\\/v1', '\\/refresh', \\[\\s*'methods'\\s*=> 'POST',\\s*'permission_callback' => '__return_true'/", $scs ) === 1, 'refresh is a public POST route' );

require __DIR__ . '/faq.test.php';

/* AI search hygiene (industry snippet 1.7.0): unique meta, live-only wording, summary and facts per page */
if ( ! defined( 'ABSPATH' ) ) { define( 'ABSPATH', '/' ); }
foreach ( array( 'add_filter', 'add_action', 'is_page' ) as $ihf ) { if ( ! function_exists( $ihf ) ) { eval( "function $ihf() {}" ); } }
if ( ! function_exists( 'home_url' ) ) { function home_url( $p = '' ) { return 'https://personalisationhub.com' . $p; } }
require_once dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/ai-hygiene.php';
$ihd = dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/';
$ihns = 'AngieSnippets\\PhIndustryEnhancements_10063\\';
eval( 'namespace AngieSnippets\\PhIndustryEnhancements_10063; function data( $f ) { return require \'' . $ihd . '\' . $f; } function page_url( $k ) { return \'industries\' === $k ? home_url( \'/industries/\' ) : home_url( \'/industries/\' . $k . \'/\' ); }' );
require_once $ihd . 'redirects.php';
foreach ( array( 'is_admin', 'wp_doing_ajax', 'wp_doing_cron' ) as $rf ) { if ( ! function_exists( $rf ) ) { eval( "function $rf() { return false; }" ); } }
$rt = $ihns . 'redirect_target';
$nw = '/white-label-retail-media-platform/';
ok( $rt( '/retail-media-platform/' ) === $nw && $rt( '/retail-media-platform' ) === $nw, 'redirect: old path with and without slash' );
ok( $rt( '/Retail-Media-Platform/' ) === $nw, 'redirect: case-insensitive' );
ok( $rt( '/retail-media-platform/?format=md' ) === $nw . '?format=md' && $rt( '/retail-media-platform?a=1&b=2' ) === $nw . '?a=1&b=2', 'redirect: query string kept' );
ok( $rt( '/retail-media-platform/', 'HEAD' ) === $nw && $rt( '/retail-media-platform/', 'POST' ) === '', 'redirect: GET and HEAD only' );
foreach ( array( '/white-label-retail-media-platform/', '/industries/retail-media/', '/retail-media-platform/x/', '/foo/retail-media-platform/', '/retail-media-platforms/', '/', '' ) as $np ) { ok( $rt( $np ) === '', "redirect: $np is not redirected" ); }
$sd = $ihns . 'slug_move_decision';
$mk = function ( $name, $status = 'publish', $type = 'page' ) { return (object) array( 'post_name' => $name, 'post_status' => $status, 'post_type' => $type ); };
$sm = ( $ihns . 'slug_moves' )();
ok( isset( $sm[3266] ) && $sm[3266] === array( 'retail-media-platform', 'white-label-retail-media-platform' ), 'slug move: page 3266 listed' );
ok( $sd( $mk( 'retail-media-platform' ), array(), 3266, 'retail-media-platform', 'white-label-retail-media-platform' ) === 'white-label-retail-media-platform', 'slug move: old slug moves' );
ok( $sd( $mk( 'white-label-retail-media-platform' ), array(), 3266, 'retail-media-platform', 'white-label-retail-media-platform' ) === '', 'slug move: new slug does nothing' );
ok( $sd( $mk( 'something-else' ), array(), 3266, 'retail-media-platform', 'white-label-retail-media-platform' ) === '', 'slug move: other slug does nothing' );
ok( $sd( $mk( 'retail-media-platform', 'draft' ), array(), 3266, 'retail-media-platform', 'white-label-retail-media-platform' ) === '', 'slug move: draft does nothing' );
ok( $sd( null, array(), 3266, 'retail-media-platform', 'white-label-retail-media-platform' ) === '', 'slug move: missing post does nothing' );
ok( $sd( $mk( 'retail-media-platform' ), array( 3266 ), 3266, 'retail-media-platform', 'white-label-retail-media-platform' ) === '', 'slug move: already done does nothing' );
ok( ! isset( ( $ihns . 'ai_feature_pages' )()['retail-media-platform'] ), 'ai_feature_pages no longer lists the moved page' );
$ihdescs = array();
$ihpages = array();
foreach ( array_keys( ( $ihns . 'ai_industry_names' )() ) as $k ) { $ihpages[] = array( 'industry', $k ); }
foreach ( array_keys( ( $ihns . 'ai_feature_pages' )() ) as $k ) { $ihpages[] = array( '/' === $k ? 'home' : 'feature', $k ); }
foreach ( $ihpages as $pg ) {
	list( $t, $k ) = $pg;
	$d = ( $ihns . 'ai_meta_desc' )( $t, $k );
	$ihdescs[] = $d;
	ok( strlen( $d ) <= 170, "fallback description length ok for $k" );
	$sum = ( $ihns . 'ai_summary' )( $t, $k );
	ok( stripos( $sum, 'Personalisation Hub' ) !== false && stripos( $sum, 'AWS' ) !== false || 'industry' === $t, "summary names the product and where it runs for $k" );
	$facts = ( $ihns . 'ai_facts' )( $t, $k );
	$all = $d . $sum . implode( ' ', $facts ) . implode( ' ', ( $ihns . 'ai_related' )( $t, $k ) );
	ok( ! preg_match( '/\bDSP\b|programmatic|personaliz/i', $all ), "no DSP, programmatic or Z spelling for $k" );
	ok( count( ( $ihns . 'ai_related' )( $t, $k ) ) >= 3, "at least 3 internal links for $k" );
	ok( count( $facts ) >= 5, "at least 5 facts for $k" );
	ok( isset( $facts['Installation time'] ) && strpos( $facts['Installation time'], '1 hour 15 minutes' ) !== false, "installation time states the Marketplace figure for $k" );
}
ok( count( array_unique( $ihdescs ) ) === count( $ihdescs ), 'fallback descriptions are unique' );
$ihsrc = file_get_contents( $ihd . 'ai-hygiene.php' );
ok( strpos( $ihsrc, 'seopress_titles_title' ) === false, 'curated SEOPress titles are never filtered' );
ok( strpos( $ihsrc, '<div class="ph-ai-lead">' ) === false, 'no .ph-ai-lead block is printed before the content' );
ok( strpos( $ihsrc, 'return $html . $tail;' ) !== false && strpos( $ihsrc, 'return $lead . $html' ) === false, 'content filter does not prepend anything' );
ok( preg_match( '/<\/h2>\'\s*\. \$lead\s*\. \$facts/', $ihsrc ) === 1 && strpos( $ihsrc, 'class="ph-ai-summary"' ) !== false, '.ph-ai-summary sits inside .ph-ai-facts before the facts' );
ok( strpos( $ihsrc, 'ph-ai-lead-move' ) === false, 'no script moves the summary' );
ok( ( $ihns . 'ai_desc_needs_fallback' )( '', array() ) && ( $ihns . 'ai_desc_needs_fallback' )( 'Ditch the Queue', array( 'Ditch the Queue' ) ), 'description filled when empty or duplicated' );
ok( ! ( $ihns . 'ai_desc_needs_fallback' )( 'Own curated description', array( 'Another page' ) ), 'a unique curated description is kept' );

/* ------------------------------------------------------------ installation spec (get_installation_spec) */
$src = array(); // the tool reads no live content
$is = run_tool( 'get_installation_spec', array(), $src );
ok( empty( $is['isError'] ) && isset( $is['structuredContent'] ), 'install spec: tool answers with structured content' );
$sp = $is['structuredContent'];
ok( $sp['marketplace']['listingUrl'] === 'https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76' && $sp['marketplace']['listingUrl'] === \AngieSnippets\PhAgentEndpoint___ID__\FREE_TRIAL_URL, 'install spec: listing URL is the one free-trial URL' );
ok( $sp['marketplace']['productId'] === '76fb12fb-ca7e-4352-b691-6aa83d9be3e2' && $sp['marketplace']['subscribeUrl'] === 'https://aws.amazon.com/marketplace/procurement?productId=76fb12fb-ca7e-4352-b691-6aa83d9be3e2', 'install spec: product id and subscribe link' );
ok( $sp['marketplace']['trackedTrialUrl'] === 'https://personalisationhub.com/go/free-trial/?via=webmcp', 'install spec: tracked trial link' );
ok( array_column( $sp['pricing']['dimensions'], 'usd' ) === array( 6.94, 0.1375, 0.1375 ), 'install spec: three pricing dimensions' );
ok( ! empty( $sp['humanApproval']['required'] ) && count( $sp['humanApproval']['steps'] ) === 3, 'install spec: EULA, subscription and IAM acknowledgement left to a human' );
foreach ( array( 'prerequisites', 'template', 'deployment', 'verification', 'recovery', 'handOff', 'pricing', 'marketplace' ) as $k ) {
	ok( ! empty( $sp[ $k ] ), "install spec: has $k" );
}
ok( count( $sp['template']['parameters'] ) >= 3 && isset( $sp['template']['parameters'][1]['validation'] ) && false !== strpos( $sp['template']['parameters'][1]['validation'], '15' ), 'install spec: ResourcePrefix rule is present' );
ok( 'EC2InstancePublicURL' === $sp['deployment']['outputs'][0]['key'], 'install spec: wizard URL output' );
/* Honesty: nothing unpublished may be invented. Each of these stays null until the owner supplies it. */
$un = unconfirmed_paths( $sp );
foreach ( array( 'prerequisites.iamPolicy', 'template.url', 'verification.healthCheckEndpoint', 'pricing.estimatedRunningCost' ) as $k ) {
	ok( isset( $un[ $k ] ) && null === $un[ $k ]['value'] && '' !== $un[ $k ]['note'], "install spec: $k is marked unconfirmed with a null value" );
}
$raw = json_encode( $sp );
ok( false === strpos( $raw, '"Statement"' ) && false === strpos( $raw, 'cloudformation.amazonaws.com' ) && false === strpos( $raw, 's3.amazonaws.com' ), 'install spec: no invented IAM policy or template URL' );
ok( 0 === preg_match( '/AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE|password\s*[:=]/i', $raw ), 'install spec: public content only, no credentials' );
/* One source: the text is built from the same array, and a second source (the remote server) sees identical data. */
ok( $is['content'][0]['text'] === installation_spec_md( $sp ), 'install spec: markdown text is built from the structured data' );
$sp2 = run_tool( 'get_installation_spec', array(), $src )['structuredContent'];
ok( $sp2 === $sp, 'install spec: identical on every call' );
$bare = installation_spec();
ok( null === $bare['marketplace']['trackedTrialUrl'], 'install spec: source data holds no per-surface link' );
ok( ! empty( run_tool( 'get_installation_spec', array( 'x' => 1 ), $src )['isError'] ), 'install spec: takes no arguments' );
ok( false === stripos( $is['content'][0]['text'], 'seamless' ) && false === stripos( $is['content'][0]['text'], 'leverage' ), 'install spec: no banned words' );

/* industry lead forms -> console Leads payload (no WordPress needed for the pure builder) */
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ );
}
require_once dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/leads.php';
$lb = \AngieSnippets\PhIndustryEnhancements_10063\lead_ingest_body( array( 'company' => 'Acme', 'website' => 'acme.com', 'company_industry' => 'Telco', 'industry' => 'telco', 'countries' => 'UK, France', 'store_count' => '120', 'contact_name' => 'Ann', 'job_title' => 'CTO', 'email' => 'a@acme.com', 'linkedin' => 'linkedin.com/in/a', 'page' => 'https://personalisationhub.com/industries/telco/', 'test' => true ) );
ok( $lb['company'] === 'Acme' && $lb['contactName'] === 'Ann' && $lb['jobTitle'] === 'CTO' && $lb['storeCount'] === '120', 'industry lead maps to console field names' );
ok( $lb['pageIndustry'] === 'telco' && $lb['industry'] === 'Telco' && strpos( $lb['page'], '/industries/telco/' ) !== false, 'industry lead carries page and industry' );
ok( true === $lb['test'], 'test flag forwarded' );
$lb2 = \AngieSnippets\PhIndustryEnhancements_10063\lead_ingest_body( array( 'name' => 'Bo', 'company' => 'Zed', 'role' => 'Head', 'email' => 'b@z.com', 'industry' => 'telco', 'source' => 'telco-business-model' ) );
ok( $lb2['contactName'] === 'Bo' && $lb2['jobTitle'] === 'Head' && $lb2['industry'] === 'telco' && ! isset( $lb2['test'] ), 'telco gate lead maps and is a real lead without the flag' );

/* regression guard: the lead form, test mode and page field must not be dropped by a later edit of enhance.js / telco-lead.php */
$dir = dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/';
$ejs = file_get_contents( $dir . 'enhance.js' );
ok( false === strpos( $ejs, 'retail: "Retail"' ), 'enhance.js: no Talk to us lead form on the retail page' );
ok( false !== strpos( $ejs, 'LEAD_FORM' ) && false !== strpos( $ejs, 'function setupLeadForm' ) && false !== strpos( $ejs, 'setupLeadForm();' ), 'enhance.js: LEAD_FORM and setupLeadForm are wired' );
ok( false !== strpos( $ejs, 'function testMode' ) && false !== strpos( $ejs, 'ph_test=1' ), 'enhance.js: testMode reads ?ph_test=1' );
ok( 1 === preg_match( '/var body = \{inputs: current\(\), consent: cb\.checked, page: location\.origin \+ location\.pathname\};\s*if \(testMode\(\)\) body\.test = true;/', $ejs ), 'enhance.js: telco gate body carries page and test' );
ok( false !== strpos( $ejs, 'pageIndustry: page, page: location.origin' ) && false !== strpos( $ejs, 'body.test = true' ), 'enhance.js: lead form body carries page and test' );
ok( false !== strpos( file_get_contents( $dir . 'enhance.css' ), '.ph-ind-lead{' ), 'enhance.css: .ph-ind-lead styles present' );
$tl = file_get_contents( $dir . 'telco-lead.php' );
ok( false !== strpos( $tl, "'ph_lead_test'" ) && false !== strpos( $tl, "'test' => \$test" ) && false !== strpos( $tl, "'page' =>" ) && 1 === preg_match( '/if \( ! \$test \) \{\s*wp_mail/', $tl ), 'telco-lead.php: test flag, page, ph_lead_test and no admin email for test leads' );
$mp = file_get_contents( $dir . 'main.php' );
ok( 1 === preg_match( "/ASSETS_VERSION_10063 = '(\d+)\.(\d+)\.(\d+)'/", $mp, $vm ) && ( (int) $vm[2] > 8 || ( (int) $vm[2] === 8 && (int) $vm[3] >= 2 ) ), 'main.php: assets version bumped past 1.8.1' );
ok( false !== strpos( file_get_contents( $dir . 'leads.php' ), "'ph_lead_ingest_key'" ) && false !== strpos( file_get_contents( $dir . 'leads.php' ), 'PH lead ingest key' ), 'leads.php: ingest key settings field' );

/* interactive product tour: one shared source, telco and pharmacy (9 Nov 2026) */
$tsrc = file_get_contents( $dir . 'tour/tour.html' );
ok( ! file_exists( $dir . 'tour/telco.html' ), 'tour: single source tour/tour.html (telco.html is gone)' );
ok( false !== strpos( $tsrc, 'IND_FROM_PATH' ) && false !== strpos( $tsrc, 'ind: IND_FROM_PATH' ) && false !== strpos( $tsrc, '/industries\\/pharmacy\\/tour' ), 'tour: S.ind comes from the page path' );
ok( false !== strpos( $tsrc, 'industry: S.ind' ) && false === strpos( $tsrc, 'industry: "telco"' ), 'tour: events and lead body use S.ind, not a hard-coded telco' );
ok( false !== strpos( $tsrc, 'Sun Care | 2 for $30 SPF 50+' ) && false !== strpos( $tsrc, 'Gold Members | Extra 20% off sun care' ) && false !== strpos( $tsrc, 'Sunscreen out of stock' ), 'tour: pharmacy is the sun care campaign' );
ok( 0 === preg_match( '/Scripts Ready|Flu Vaccine|Flu Season|Prescription Ready|Age 68/', $tsrc ), 'tour: no prescription, vaccine or age content left in the pharmacy tour' );
$tp = file_get_contents( $dir . 'tour.php' );
ok( false !== strpos( $tp, "'pharmacy' => array(" ) && false !== strpos( $tp, 'Interactive product tour – Pharmacy' ) && false !== strpos( $tp, "'/industries/pharmacy/tour'" ) && false !== strpos( $tp, 'Unknown industry.' ), 'tour.php: pharmacy route, label and industry validation' );
ok( false !== strpos( $tp, hash( 'sha256', $tsrc ) ), 'tour.php: TOUR_PAGE_SHA256 is the sha256 of tour/tour.html' );
ok( false !== strpos( $ejs, 'See Personalisation Hub run a pharmacy campaign, end to end' ) && false !== strpos( $ejs, 'and on to the pharmacist.' ) && false !== strpos( $ejs, '"/industries/" + page + "/tour/?embed=1"' ), 'enhance.js: the tour mounts on the pharmacy page with pharmacy copy' );
ok( 1 === preg_match( "/ASSETS_VERSION_10063 = '(\d+)\.(\d+)\.(\d+)'/", $mp, $vm2 ) && ( (int) $vm2[2] > 9 || ( (int) $vm2[2] === 9 && (int) $vm2[3] >= 3 ) ), 'main.php: assets version bumped to 1.9.3 for the pharmacy tour' );

require __DIR__ . '/ai-surface.test.php';
require __DIR__ . '/help-proxy.test.php';
/* PH Blog abilities: own process (it stubs the hook functions itself) */
exec( escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( __DIR__ . '/ph-blog-abilities.test.php' ) . ' 2>&1', $abl_out, $abl_rc );
ok( 0 === $abl_rc, 'ph-blog-abilities.test.php: ' . implode( ' ', $abl_out ) );

fwrite( STDOUT, $fails ? "ph-website: $fails of $n checks FAILED\n" : "ph-website: all $n checks passed\n" );
exit( $fails ? 1 : 0 );
