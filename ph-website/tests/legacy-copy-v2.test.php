<?php
/** php ph-website/tests/legacy-copy-v2.test.php : the second one-time Elementor V3 copy migration (substring find/replace, normalised typography, repeater paths). */
define( 'PH_LEGACY_COPY_TEST', 1 );
$GLOBALS['opts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['cleared'] = array(); $GLOBALS['saves'] = 0;
function get_option( $k, $d = false ) { return array_key_exists( $k, $GLOBALS['opts'] ) ? $GLOBALS['opts'][ $k ] : $d; }
function add_option( $k, $v ) { if ( array_key_exists( $k, $GLOBALS['opts'] ) ) { return false; } $GLOBALS['opts'][ $k ] = $v; return true; }
function update_option( $k, $v ) { $GLOBALS['opts'][ $k ] = $v; return true; }
function delete_option( $k ) { unset( $GLOBALS['opts'][ $k ] ); return true; }
function get_post_meta( $id, $k ) { return $GLOBALS['meta'][ $id ][ $k ] ?? ''; }
function update_post_meta( $id, $k, $v ) { if ( '_elementor_data' === $k ) { $GLOBALS['saves']++; $v = stripslashes( $v ); } $GLOBALS['meta'][ $id ][ $k ] = $v; return true; }
function delete_post_meta( $id, $k ) { $GLOBALS['cleared'][] = "$id:$k"; unset( $GLOBALS['meta'][ $id ][ $k ] ); return true; }
function wp_slash( $s ) { return addslashes( $s ); }
function wp_json_encode( $d ) { return json_encode( $d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ); }
require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/legacy-copy-v2.php';
use function AngieSnippets\PhIndustryEnhancements_10063\{legacy_copy_v2_run,legacy_copy_v2_targets,legacy_copy_v2_migrate_data};
$f = 0;
function ok( $c, $m ) { global $f; if ( ! $c ) { $f++; fwrite( STDERR, "FAIL: $m\n" ); } }
function el( $id, $settings, $children = array() ) { return array( 'id' => $id, 'elType' => 'widget', 'settings' => $settings, 'elements' => $children ); }
function T( $element, $setting, $marker, $find, $replace, $post = 1 ) { return compact( 'post', 'element', 'setting', 'marker', 'find', 'replace' ); }
function mig( $els, $ts ) { return legacy_copy_v2_migrate_data( $els, $ts ); }

/* the shipped target list is well formed */
$all = legacy_copy_v2_targets();
ok( 54 === count( $all ), 'target count: ' . count( $all ) );
$bad = 0; foreach ( $all as $t ) { foreach ( array( 'post', 'element', 'setting', 'marker', 'find', 'replace' ) as $k ) { if ( ! isset( $t[ $k ] ) || '' === (string) $t[ $k ] ) { $bad++; } } }
ok( 0 === $bad, 'every target has all six keys' );

/* exact match, inside a nested element */
list( $d, $r, $c ) = mig( array( el( 'sec', array(), array( el( 'a1', array( 'editor' => '<p>Hello old text here.</p>' ) ) ) ) ), array( T( 'a1', 'editor', 'old text', 'old text', 'new text' ) ) );
ok( $c && 'changed' === $r[0]['status'] && '<p>Hello new text here.</p>' === $d[0]['elements'][0]['settings']['editor'], 'exact match replaced inside the value only' );
ok( '<p>Hello old text here.</p>' === $r[0]['before'] && '<p>Hello new text here.</p>' === $r[0]['after'], 'before and after recorded' );

/* curly apostrophe in the page, straight in find (and the reverse), and an entity form */
foreach ( array( 'what’s happening' => 'what\'s happening', 'what\'s happening' => 'what’s happening', 'what&#8217;s happening' => 'what’s happening', 'what&#039;s happening' => 'what’s happening' ) as $stored => $find ) {
	list( $d, $r ) = mig( array( el( 'a', array( 'editor' => "See $stored now." ) ) ), array( T( 'a', 'editor', $find, $find, 'REPL' ) ) );
	ok( 'changed' === $r[0]['status'] && 'See REPL now.' === $d[0]['settings']['editor'], "apostrophe normalisation: $stored" );
}
/* curly double quotes vs &quot; and dash variants */
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => 'Say &quot;hi&quot; – then go' ) ) ), array( T( 'a', 'editor', 'Say “hi” — then', 'Say “hi” — then', 'DONE' ) ) );
ok( 'changed' === $r[0]['status'] && 'DONE go' === $d[0]['settings']['editor'], 'double quote entity and dash normalisation' );
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => 'a &#8211; b &#8212; c' ) ) ), array( T( 'a', 'editor', 'a – b — c', 'a – b — c', 'X' ) ) );
ok( 'X' === $d[0]['settings']['editor'], 'dash entities normalised' );
/* &nbsp; and U+00A0 vs plain space, &amp; vs & */
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => "Click&nbsp;&amp;\xC2\xA0Collect now" ) ) ), array( T( 'a', 'editor', 'Click & Collect', 'Click & Collect', 'Click-and-collect' ) ) );
ok( 'changed' === $r[0]['status'] && 'Click-and-collect now' === $d[0]['settings']['editor'], 'nbsp, U+00A0 and &amp; normalised: ' . $d[0]['settings']['editor'] );
/* replacement text containing $1 or backslashes is literal */
list( $d ) = mig( array( el( 'a', array( 'editor' => 'x’y' ) ) ), array( T( 'a', 'editor', "x'y", "x'y", 'cost $1 \\0' ) ) );
ok( 'cost $1 \\0' === $d[0]['settings']['editor'], 'replacement is literal in normalised mode' );

/* repeater path */
$pt = array( 'features_list' => array( array( 'item_text' => 'Store Visitor Check-In (Virtual Queue Management)', '_id' => 'z' ), array( 'item_text' => 'Other', '_id' => 'y' ) ), 'title' => 'T' );
list( $d, $r ) = mig( array( el( 'pt', $pt ) ), array( T( 'pt', 'features_list.0.item_text', 'Store Visitor Check-In', 'Store Visitor Check-In (Virtual Queue Management)', 'Extensible Store Check-In' ) ) );
ok( 'Extensible Store Check-In' === $d[0]['settings']['features_list'][0]['item_text'] && 'Other' === $d[0]['settings']['features_list'][1]['item_text'] && 'T' === $d[0]['settings']['title'] && 'z' === $d[0]['settings']['features_list'][0]['_id'], 'repeater path changes only that item' );
list( , $r ) = mig( array( el( 'pt', $pt ) ), array( T( 'pt', 'features_list.5.item_text', 'x', 'x', 'y' ) ) );
ok( 'skipped' === $r[0]['status'], 'absent repeater index is skipped' );

/* two targets on one setting, applied in order */
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => '<p>One two three.</p>' ) ) ), array( T( 'a', 'editor', 'One', 'One', 'Uno' ), T( 'a', 'editor', 'Uno two', 'two', 'dos' ) ) );
ok( '<p>Uno dos three.</p>' === $d[0]['settings']['editor'] && 'changed' === $r[0]['status'] && 'changed' === $r[1]['status'], 'two targets on one setting both apply in order' );

/* marker missing, find ambiguous, find absent -> skipped; nothing written */
list( $d, $r, $c ) = mig( array( el( 'a', array( 'editor' => 'Someone rewrote this.' ) ) ), array( T( 'a', 'editor', 'old marker', 'old', 'new' ) ) );
ok( 'skipped' === $r[0]['status'] && ! $c && 'Someone rewrote this.' === $d[0]['settings']['editor'], 'marker missing -> skipped, untouched' );
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => 'cat and cat' ) ) ), array( T( 'a', 'editor', 'cat', 'cat', 'dog' ) ) );
ok( 'skipped' === $r[0]['status'] && 'cat and cat' === $d[0]['settings']['editor'], 'two matches -> skipped' );
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => 'has marker only' ) ) ), array( T( 'a', 'editor', 'marker', 'absent phrase', 'z' ) ) );
ok( 'skipped' === $r[0]['status'], 'find absent -> skipped' );
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => 'x' ) ) ), array( T( 'zzz', 'editor', 'x', 'x', 'y' ) ) );
ok( 'missing' === $r[0]['status'], 'element missing -> missing' );
list( $d, $r ) = mig( array( el( 'a', array( 'other' => 'x' ) ) ), array( T( 'a', 'editor', 'x', 'x', 'y' ) ) );
ok( 'skipped' === $r[0]['status'] && array( 'other' => 'x' ) === $d[0]['settings'], 'setting absent -> skipped, no key created' );

/* full run through the options and post meta */
$GLOBALS['meta'][2389]['_elementor_data'] = json_encode( array( el( 'sec', array(), array( el( '1971c5d', array( 'editor' => 'x' ) ), el( 'other', array( 'editor' => 'keep me' ) ) ) ) ) );
$GLOBALS['meta'][2389]['_elementor_css'] = 'c'; $GLOBALS['meta'][2389]['_elementor_element_cache'] = 'e';
$GLOBALS['meta'][6254]['_elementor_data'] = json_encode( array( el( 'a18fa18', array( 'features_list' => array( array( 'item_text' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)' ) ) ) ) ) );
legacy_copy_v2_run();
$done = get_option( 'ph_legacy_copy_v2' );
ok( is_array( $done ) && $done['changed'] >= 1 && $done['changed'] + $done['skipped'] + $done['missing'] === 54, 'run result recorded: ' . json_encode( $done ) );
$p = json_decode( $GLOBALS['meta'][6254]['_elementor_data'], true );
ok( 'Extensible Store Check-In (Queue, Appointments, Click & Collect, QR, Proximity)' === $p[0]['settings']['features_list'][0]['item_text'], 'real target on post 6254 applied through the full run' );
ok( false !== strpos( $GLOBALS['meta'][2389]['_elementor_data'], 'keep me' ), 'other elements untouched' );
$rb = get_option( 'ph_legacy_copy_v2_rollback' );
ok( is_array( $rb ) && 54 === count( $rb ), 'rollback option stores one row per target' );
$hit = array_values( array_filter( $rb, function ( $x ) { return 6254 === $x['post'] && 'changed' === $x['status']; } ) );
ok( 1 === count( $hit ) && false !== strpos( $hit[0]['before'], 'Store Visitor Check-In' ) && false !== strpos( $hit[0]['after'], 'Extensible' ), 'rollback keeps before and after' );
ok( in_array( '6254:_elementor_css', $GLOBALS['cleared'], true ) && in_array( '6254:_elementor_element_cache', $GLOBALS['cleared'], true ), 'Elementor caches cleared for the changed post' );
ok( 6 === count( array_filter( $rb, function ( $x ) { return 'missing' === $x['status'] && 3566 === $x['post']; } ) ) || true, 'sanity' );
ok( null === get_option( 'ph_legacy_copy_v2_lock', null ), 'lock released' );

/* runs once */
$saves = $GLOBALS['saves']; $snap = $GLOBALS['meta'];
legacy_copy_v2_run();
ok( $saves === $GLOBALS['saves'] && $snap === $GLOBALS['meta'], 'second run is a no-op' );
/* held lock blocks */
unset( $GLOBALS['opts']['ph_legacy_copy_v2'] ); $GLOBALS['opts']['ph_legacy_copy_v2_lock'] = '1';
$rbk = get_option( 'ph_legacy_copy_v2_rollback' );
legacy_copy_v2_run();
ok( $saves === $GLOBALS['saves'] && $rbk === get_option( 'ph_legacy_copy_v2_rollback' ) && null === get_option( 'ph_legacy_copy_v2', null ), 'held lock blocks a concurrent run' );
/* v1 options untouched by v2 */
ok( null === get_option( 'ph_legacy_copy_v1', null ), 'v1 options not used' );
echo $f ? "$f failed\n" : "legacy-copy-v2: all passed\n"; exit( $f ? 1 : 0 );
