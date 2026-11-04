<?php
/**
 * Offline tests for the PH Media snippet. No WordPress, no network:
 *   php ph-website/tests/ph-media.test.php
 */
error_reporting( E_ALL );
define( 'ABSPATH', '/' );
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
$GLOBALS['filters'] = [];
$GLOBALS['webp']    = ! getenv( 'PH_NOWEBP' );
$GLOBALS['routes']  = [];
function add_filter( $tag, $fn, $prio = 10, $args = 1 ) { $GLOBALS['filters'][ $tag ][] = [ $prio, $fn ]; }
function add_action( $tag, $fn, $prio = 10, $args = 1 ) { if ( 'rest_api_init' === $tag ) { $fn(); return; } add_filter( $tag, $fn, $prio, $args ); }
function apply_f( $tag, $val, ...$rest ) {
	$list = $GLOBALS['filters'][ $tag ] ?? [];
	usort( $list, fn( $a, $b ) => $a[0] <=> $b[0] );
	foreach ( $list as $f ) { $val = $f[1]( $val, ...$rest ); }
	return $val;
}
function wp_image_editor_supports( $a ) { return $GLOBALS['webp'] && 'image/webp' === ( $a['mime_type'] ?? '' ); }
function register_rest_route( $ns, $r, $a ) { $GLOBALS['routes'][ "$ns$r" ] = $a; }
function current_user_can( $c ) { return ! empty( $GLOBALS['admin'] ); }
function rest_ensure_response( $x ) { return $x; }
$wpdb = new class { public $postmeta = 'pm'; function get_var( $q ) { return 7; } };

require dirname( __DIR__ ) . '/snippets/ph-media/main.php';
use function AngieSnippets\PhMedia\converting;
use function AngieSnippets\PhMedia\fix_srcset;

$fmt = fn( $mime ) => apply_f( 'image_editor_output_format', [], '/x/a.png', $mime );

/* feature detect: a child run with an editor that cannot write WebP converts nothing */
if ( getenv( 'PH_NOWEBP' ) ) {
	apply_f( 'big_image_size_threshold', 2560 );
	ok( ! converting() && $fmt( 'image/png' ) === [], 'no WebP support: nothing converted' );
	echo "child ok\n";
	exit( $fails ? 1 : 0 );
}
ok( $fmt( 'image/png' ) === [], 'before sub-size generation nothing is converted (site icon stays PNG)' );
apply_f( 'big_image_size_threshold', 2560 );
ok( converting(), 'switch on after big_image_size_threshold' );
ok( $fmt( 'image/png' ) === [ 'image/png' => 'image/webp' ], 'PNG becomes WebP during sub-sizes' );
ok( $fmt( 'image/jpeg' ) === [ 'image/jpeg' => 'image/webp' ], 'JPEG becomes WebP during sub-sizes' );
ok( $fmt( 'image/gif' ) === [], 'GIF untouched' );
ok( $fmt( 'image/svg+xml' ) === [], 'SVG untouched' );
ok( apply_f( 'big_image_size_threshold', 2560 ) === 2560, 'threshold value passes through' );
apply_f( 'wp_generate_attachment_metadata', [ 'x' => 1 ] );
ok( ! converting(), 'switch off after wp_generate_attachment_metadata' );
ok( $fmt( 'image/png' ) === [], 'PNG stays PNG after generation (favicon build)' );
apply_f( 'big_image_size_threshold', 2560 );
apply_f( 'wp_update_attachment_metadata', [] );
ok( ! converting(), 'switch off after wp_update_attachment_metadata' );
ok( apply_f( 'wp_editor_set_quality', 82, 'image/webp' ) === 80, 'webp quality 80' );
ok( apply_f( 'wp_editor_set_quality', 82, 'image/jpeg' ) === 82, 'jpeg quality untouched' );

/* srcset */
$meta = [ 'sizes' => [ 'medium' => [ 'file' => 'target-300.png' ], 'e' => [ 'file' => 'elementor/thumbs/target-qn4pj.png' ] ] ];
$bad  = 'https://x.test/wp-content/uploads/2024/04/elementor/thumbs/target-qn4pj.png';
$ok   = 'https://x.test/wp-content/uploads/2024/04/target-300.png';
$out  = fix_srcset( [ 500 => [ 'url' => $bad, 'descriptor' => 'w', 'value' => 500 ], 300 => [ 'url' => $ok, 'descriptor' => 'w', 'value' => 300 ] ], [], '', $meta, 1 );
ok( $out[500]['url'] === 'https://x.test/wp-content/uploads/elementor/thumbs/target-qn4pj.png', 'elementor thumb URL rewritten' );
ok( $out[300]['url'] === $ok, 'normal candidate untouched' );
$out = fix_srcset( [ 500 => [ 'url' => str_replace( 'qn4pj', 'gone', $bad ), 'descriptor' => 'w', 'value' => 500 ] ], [], '', $meta, 1 );
ok( $out === [], 'candidate dropped when metadata does not list the file' );

putenv( 'PH_NOWEBP=1' );
exec( escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( __FILE__ ) . ' 2>&1', $out2, $rc );
ok( 0 === $rc, 'no-WebP child run passes: ' . implode( ' ', $out2 ) );
putenv( 'PH_NOWEBP' );

/* REST */
$r = $GLOBALS['routes']['ph-site/v1/media/webp-status'] ?? null;
ok( $r && 'POST' === $r['methods'], 'route registered as POST' );
ok( false === $r['permission_callback'](), 'non-admin refused' );
$GLOBALS['admin'] = true;
ok( true === $r['permission_callback'](), 'admin allowed' );
$s = $r['callback']();
ok( true === $s['webp_output_active'] && 7 === $s['attachments_with_webp'], 'status reports active and count' );

echo "ph-media: $n checks, $fails failed\n";
exit( $fails ? 1 : 0 );
