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
use function PhAgentEndpoint\{allow_list,is_exposable,graph_for,json_ld,organization_node,software_node,html_to_markdown,markdown_twin,llms_sections,twin_url,page_url};

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
ok( strpos( $out, 'help-api/mcp' ) !== false && strpos( $out, 'WebMCP' ) !== false, 'agents section lists MCP and WebMCP' );
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
	7020 => (object) array( 'ID' => 7020, 'post_type' => 'page', 'post_status' => 'publish', 'post_password' => '', 'post_title' => 'Digital Signage', 'post_excerpt' => 'Sig', 'post_modified_gmt' => 'x' ),
	3477 => (object) array( 'ID' => 3477, 'post_type' => 'page', 'post_status' => 'draft', 'post_password' => '', 'post_title' => 'Store Sites', 'post_excerpt' => '', 'post_modified_gmt' => 'x' ),
	3566 => (object) array( 'ID' => 3566, 'post_type' => 'page', 'post_status' => 'publish', 'post_password' => 'pw', 'post_title' => 'Personalisation', 'post_excerpt' => '', 'post_modified_gmt' => 'x' ),
	555  => (object) array( 'ID' => 555, 'post_type' => 'page', 'post_status' => 'publish', 'post_password' => '', 'post_title' => 'Lindt Chocolate', 'post_excerpt' => '', 'post_modified_gmt' => 'x' ),
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

fwrite( STDOUT, $fails ? "ph-website: $fails of $n checks FAILED\n" : "ph-website: all $n checks passed\n" );
exit( $fails ? 1 : 0 );
