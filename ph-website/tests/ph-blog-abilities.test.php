<?php
/**
 * Offline tests for the PH Blog abilities (snippets/ph-blog/abilities.php). Required from run.php, or on its own:
 *   php ph-website/tests/ph-blog-abilities.test.php
 * Only the pure validation functions run here. WordPress calls (download_url, media_handle_sideload, wp_insert_post)
 * are covered by the live error-path checks after deploy.
 */
if ( ! function_exists( 'ok' ) ) {
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
	$standalone = true;
}
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', '/' );
}
/* the file registers hooks on load: record them */
$GLOBALS['pba_hooks'] = array();
if ( ! function_exists( 'add_action' ) ) {
	function add_action( $tag, $fn ) { $GLOBALS['pba_hooks'][ $tag ][] = $fn; }
}
if ( ! function_exists( 'add_filter' ) ) {
	function add_filter( $tag, $fn ) { $GLOBALS['pba_hooks'][ $tag ][] = $fn; }
}
require_once dirname( __DIR__ ) . '/snippets/ph-blog/abilities.php';
use function AngieSnippets\PhBlog_10116\{schema_for,validate_input,check_url,check_slug,check_mime,check_category,readnext_pick};

$U = schema_for( 'upload' );
$C = schema_for( 'create' );
$P = schema_for( 'update' );
$post = array( 'title' => 'T', 'slug' => 'a-b', 'content' => '<p>x</p>', 'category' => 'retail-media' );

/* slug: valid; not sanitised; taken */
ok( null === check_slug( 'experiential-retail-media', 'experiential-retail-media', false ), 'slug: valid' );
ok( null !== check_slug( 'Experiential Retail', 'experiential-retail', false ), 'slug: not sanitised is refused' );
ok( false !== strpos( (string) check_slug( 'Experiential Retail', 'experiential-retail', false ), 'experiential-retail' ), 'slug: error suggests the sanitised form' );
ok( null !== check_slug( '', '', false ), 'slug: empty refused' );
$taken = (string) check_slug( 'in-store-retail-media-explained', 'in-store-retail-media-explained', true );
ok( false !== strpos( $taken, 'already used' ) && false === strpos( $taken, '-2' ), 'slug: taken is refused, never suffixed' );

/* url: https only */
ok( null === check_url( 'https://www.canva.com/design/x/media?sig=abc' ), 'url: https accepted (no extension)' );
foreach ( array( 'http://example.com/a.jpg', 'file:///etc/passwd', 'ftp://example.com/a.jpg', '', '/relative/a.jpg', 'a.jpg', 'https://', 'javascript:alert(1)', 'https://user:pw@example.com/a.png' ) as $bad ) {
	ok( null !== check_url( $bad ), "url: refused: $bad" );
}
ok( null !== check_url( null ), 'url: null refused' );

/* mime allow-list */
foreach ( array( 'image/jpeg', 'image/png', 'image/webp' ) as $m ) {
	ok( null === check_mime( $m ), "mime: $m accepted" );
}
foreach ( array( 'image/gif', 'image/svg+xml', 'application/pdf', '', 'text/html' ) as $m ) {
	ok( null !== check_mime( $m ), "mime: '$m' refused" );
}

/* field rules */
ok( null === validate_input( $post, $C ), 'create: minimal valid input' );
ok( null === validate_input( $post + array( 'status' => 'publish', 'excerpt' => 'e', 'featured_media_id' => 5 ), $C ), 'create: all fields valid' );
ok( null !== validate_input( $post + array( 'status' => 'pending' ), $C ), 'status enum: pending refused' );
ok( null !== validate_input( $post + array( 'status' => 'private' ), $C ), 'status enum: private refused' );
ok( null !== validate_input( array_merge( $post, array( 'title' => '' ) ), $C ), 'title: empty refused' );
ok( null === validate_input( array_merge( $post, array( 'title' => str_repeat( 'a', 200 ) ) ), $C ), 'title: 200 ok' );
ok( null !== validate_input( array_merge( $post, array( 'title' => str_repeat( 'a', 201 ) ) ), $C ), 'title: 201 refused' );
ok( null === validate_input( $post + array( 'excerpt' => str_repeat( 'e', 400 ) ), $C ), 'excerpt: 400 ok' );
ok( null !== validate_input( $post + array( 'excerpt' => str_repeat( 'e', 401 ) ), $C ), 'excerpt: 401 refused' );
ok( null !== validate_input( array_merge( $post, array( 'content' => str_repeat( 'c', 100001 ) ) ), $C ), 'content: over 100,000 refused' );
ok( null !== validate_input( array_merge( $post, array( 'content' => '' ) ), $C ), 'content: empty refused' );
ok( null === validate_input( array( 'url' => 'https://x.test/a', 'alt' => 'A' ), $U ), 'upload: minimal valid' );
ok( null !== validate_input( array( 'url' => 'https://x.test/a', 'alt' => '' ), $U ), 'alt: empty refused' );
ok( null === validate_input( array( 'url' => 'https://x.test/a', 'alt' => str_repeat( 'a', 250 ) ), $U ), 'alt: 250 ok' );
ok( null !== validate_input( array( 'url' => 'https://x.test/a', 'alt' => str_repeat( 'a', 251 ) ), $U ), 'alt: 251 refused' );
ok( null !== validate_input( array( 'alt' => 'A' ), $U ), 'upload: missing url refused' );
ok( null !== validate_input( array( 'url' => 'https://x.test/a' ), $U ), 'upload: missing alt refused' );
foreach ( array( 'title', 'slug', 'content', 'category' ) as $req ) {
	$x = $post;
	unset( $x[ $req ] );
	ok( null !== validate_input( $x, $C ), "create: missing $req refused" );
}
ok( null !== validate_input( $post + array( 'post_author' => 1 ), $C ), 'create: unknown key refused' );
ok( null !== validate_input( $post + array( 'post_type' => 'page' ), $C ), 'create: post_type is not an input' );
ok( null !== validate_input( array( 'url' => 'https://x.test/a', 'alt' => 'A', 'dest' => '/tmp' ), $U ), 'upload: unknown key refused' );
ok( null !== validate_input( $post + array( 'featured_media_id' => '5' ), $C ), 'featured_media_id: string refused' );
ok( null !== validate_input( $post + array( 'featured_media_id' => 0 ), $C ), 'featured_media_id: 0 refused' );
ok( null !== validate_input( array_merge( $post, array( 'title' => array( 'x' ) ) ), $C ), 'title: array refused' );
ok( null !== validate_input( 'nope', $C ), 'non-object input refused' );
ok( null === validate_input( array( 'post_id' => 12, 'title' => 'New' ), $P ), 'update: post_id plus a field' );
ok( null !== validate_input( array( 'title' => 'New' ), $P ), 'update: post_id required' );
ok( null !== validate_input( array( 'post_id' => 12, 'status' => 'trash' ), $P ), 'update: status enum' );
ok( null !== validate_input( array( 'post_id' => 12, 'x' => 1 ), $P ), 'update: unknown key refused' );
ok( null === validate_input( array( 'post_id' => 12, 'excerpt' => '' ), $P ), 'update: empty excerpt allowed (clears it)' );

/* category must exist (stubbed lookup) */
$cats = array( 'retail-media' => true );
ok( null === check_category( 'retail-media', isset( $cats['retail-media'] ) ), 'category: existing accepted' );
ok( null !== check_category( 'made-up', isset( $cats['made-up'] ) ), 'category: missing refused' );

/* content through wp_kses_post: the stub below mimics only the three behaviours that matter; real kses is checked live */
$src = file_get_contents( dirname( __DIR__ ) . '/snippets/ph-blog/abilities.php' );
ok( false !== strpos( $src, 'wp_kses_post( $in[\'content\'] )' ), 'content always passes through wp_kses_post' );
$kses = function ( $h ) { return preg_replace( '#<script\b.*?</script>#is', '', $h ); }; // wp_kses_post keeps comments and a[target|rel], drops script
$block = "<!-- wp:paragraph -->\n<p><a href=\"https://calendly.com/rob-offline2online\" target=\"_blank\" rel=\"noopener\">book a demo</a></p>\n<!-- /wp:paragraph --><script>alert(1)</script>";
$out   = $kses( $block );
ok( false !== strpos( $out, '<!-- wp:paragraph -->' ) && false !== strpos( $out, 'target="_blank" rel="noopener"' ) && false === strpos( $out, '<script' ), 'content: block comments, target and rel kept, script stripped (stub)' );

/* registration */
$h = $GLOBALS['pba_hooks'];
ok( ! empty( $h['wp_abilities_api_categories_init'] ) && ! empty( $h['wp_abilities_api_init'] ), 'abilities hook the Abilities API init actions' );
$reg = array();
function wp_register_ability_category( $n, $a ) { $GLOBALS['pba_cat'][ $n ] = $a; }
function wp_register_ability( $n, $a ) { $GLOBALS['pba_reg'][ $n ] = $a; }
foreach ( $h['wp_abilities_api_categories_init'] as $f ) { $f(); }
foreach ( $h['wp_abilities_api_init'] as $f ) { $f(); }
ok( isset( $GLOBALS['pba_cat']['ph-blog'] ), 'category ph-blog registered' );
foreach ( array( 'ph-blog/upload-image', 'ph-blog/create-post', 'ph-blog/update-post' ) as $a ) {
	$d = $GLOBALS['pba_reg'][ $a ] ?? null;
	ok( $d && true === $d['meta']['show_in_rest'] && true === $d['meta']['mcp']['public'] && isset( $d['meta']['annotations'] ) && 'ph-blog' === $d['category'], "$a: exposed to REST and MCP, annotated" );
	ok( $d && false === $d['input_schema']['additionalProperties'], "$a: unknown keys refused by schema" );
}
ok( 3 === count( $GLOBALS['pba_reg'] ?? array() ), 'exactly three abilities' );

/* blog.js and main.php */
$js = file_get_contents( dirname( __DIR__ ) . '/snippets/ph-blog/blog.js' );
ok( false !== strpos( $js, 'https://calendly.com/rob-offline2online' ) && false !== strpos( $js, 'window.PH_SITE_DEMO(null)' ) && false !== strpos( $js, 'typeof window.PH_SITE_DEMO !== "function"' ), 'blog.js: in-post Calendly links open the demo pop-up, fall back to the link' );
$mp = file_get_contents( dirname( __DIR__ ) . '/snippets/ph-blog/main.php' );
ok( false !== strpos( $mp, "const VER       = '1.1.1'" ) && false !== strpos( $mp, "require_once __DIR__ . '/abilities.php'" ), 'main.php: 1.1.1 requires abilities.php' );

/* Read next: next older post in the Articles list, series resolve to part 1 */
$rn = function ( $id, $ser = '', $part = 0 ) { return array( 'id' => $id, 'series' => $ser, 'part' => $part ); };
$list = array( $rn( 10 ), $rn( 9, 'a', 2 ), $rn( 8, 'a', 1 ), $rn( 7 ), $rn( 6, 'b', 3 ), $rn( 5, 'b', 1 ), $rn( 4, 'b', 2 ) );
ok( readnext_pick( 10, $list ) === 8, 'newest standalone -> next older is series a part 2 -> part 1 (8)' );
$l2 = array( $rn( 3 ), $rn( 2, 'x', 1 ), $rn( 1 ) );
ok( readnext_pick( 3, $l2 ) === 2, 'next older is series part 1 -> that post' );
$l3 = array( $rn( 7 ), $rn( 6, 'b', 3 ), $rn( 5, 'b', 1 ) );
ok( readnext_pick( 7, $l3 ) === 5, 'next older is series part 3 -> part 1' );
ok( readnext_pick( 1, $l2 ) === 3, 'oldest wraps to newest' );
$l4 = array( $rn( 9, 'a', 2 ), $rn( 8, 'a', 1 ), $rn( 7 ) );
ok( readnext_pick( 7, $l4 ) === 8, 'oldest wraps to newest series post -> part 1' );
ok( readnext_pick( 1, array( $rn( 1 ) ) ) === null, 'single post -> none' );
ok( readnext_pick( 99, $l2 ) === null, 'unknown post -> none' );

if ( ! empty( $standalone ) ) {
	fwrite( STDOUT, $fails ? "ph-blog-abilities: $fails of $n FAILED\n" : "ph-blog-abilities: all $n checks passed\n" );
	exit( $fails ? 1 : 0 );
}

