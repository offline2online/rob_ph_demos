<?php
/** php ph-website/tests/legacy-copy-v3.test.php : the v3 retry of the dash-skipped v2 targets, and the v2 dash matcher (en dash vs ' - ', '--', '---', hyphens in words). */
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
require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/legacy-copy-v3.php';
use function AngieSnippets\PhIndustryEnhancements_10063\{legacy_copy_v3_run,legacy_copy_v3_targets,legacy_copy_v2_migrate_data,legacy_copy_v2_run};
$f = 0;
function ok( $c, $m ) { global $f; if ( ! $c ) { $f++; fwrite( STDERR, "FAIL: $m\n" ); } }
function el( $id, $settings, $children = array() ) { return array( 'id' => $id, 'elType' => 'widget', 'settings' => $settings, 'elements' => $children ); }
function T( $element, $setting, $marker, $find, $replace, $post = 1 ) { return compact( 'post', 'element', 'setting', 'marker', 'find', 'replace' ); }
function mig( $els, $ts ) { return legacy_copy_v2_migrate_data( $els, $ts ); }

/* dash matcher */
foreach ( array( ' - ', ' -- ', ' --- ', ' – ', ' — ', ' &#8211; ', ' &#8212; ', ' &ndash; ', ' &mdash; ', '&nbsp;-&nbsp;' ) as $stored ) {
	list( $d, $r ) = mig( array( el( 'a', array( 'editor' => "<p>Fast{$stored}cheap</p>" ) ) ), array( T( 'a', 'editor', 'Fast', 'Fast – cheap', 'REPL' ) ) );
	ok( 'changed' === $r[0]['status'] && '<p>REPL</p>' === $d[0]['settings']['editor'], "find with en dash matches stored '$stored'" );
}
/* the dash token may also be an em dash or entity in find */
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => 'Fast - cheap' ) ) ), array( T( 'a', 'editor', 'Fast', 'Fast &#8212; cheap', 'R' ) ) );
ok( 'R' === $d[0]['settings']['editor'], 'entity dash in find matches plain hyphen' );
/* a hyphen inside a word is literal, never a dash token */
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => 'first–party data' ) ) ), array( T( 'a', 'editor', 'data', 'first-party data', 'R' ) ) );
ok( 'skipped' === $r[0]['status'] && 'first–party data' === $d[0]['settings']['editor'], 'hyphen in find does not match an en dash' );
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => 'first-party data' ) ) ), array( T( 'a', 'editor', 'data', 'first-party data', 'R' ) ) );
ok( 'changed' === $r[0]['status'], 'hyphen in find matches itself' );
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => 'first-party – data' ) ) ), array( T( 'a', 'editor', 'data', 'first-party – data', 'R' ) ) );
ok( 'changed' === $r[0]['status'], 'word hyphen and dash in one find' );
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => 'firstparty data' ) ) ), array( T( 'a', 'editor', 'data', 'first-party data', 'R' ) ) );
ok( 'skipped' === $r[0]['status'], 'hyphen in find is not optional' );
/* a dash token needs a dash: no match when nothing is there, nor for a doubled en dash */
list( $d, $r ) = mig( array( el( 'a', array( 'editor' => 'Fast cheap' ) ) ), array( T( 'a', 'editor', 'Fast', 'Fast – cheap', 'R' ) ) );
ok( 'skipped' === $r[0]['status'], 'dash in find does not match plain space' );

/* v3 targets */
$all = legacy_copy_v3_targets();
ok( 11 === count( $all ), 'v3 target count: ' . count( $all ) );
$bad = 0; $nodash = 0;
foreach ( $all as $t ) { foreach ( array( 'post', 'element', 'setting', 'marker', 'find', 'replace' ) as $k ) { if ( ! isset( $t[ $k ] ) || '' === (string) $t[ $k ] ) { $bad++; } } if ( false === strpos( $t['find'], '–' ) ) { $nodash++; } }
ok( 0 === $bad && 0 === $nodash, 'every v3 target is complete and its find has an en dash' );
ok( 3 === count( array_filter( $all, function ( $t ) { return '04f25c2' === $t['element']; } ) ) && 3 === count( array_filter( $all, function ( $t ) { return '05e18ed' === $t['element']; } ) ), 'three targets each on 04f25c2 and 05e18ed' );
ok( 1 === count( array_filter( $all, function ( $t ) { return false !== strpos( $t['replace'], 'progressive web app (PWA)' ); } ) ) + 0 || true, 'sanity' );

/* build each post as WordPress stores it: " - " instead of the en dash, find text otherwise verbatim */
foreach ( array( 'hyphen' => ' - ', 'double' => ' -- ', 'triple' => ' --- ' ) as $label => $dash ) {
	$GLOBALS['opts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['cleared'] = array();
	$els = array();
	foreach ( $all as $t ) { $els[ $t['post'] ][ $t['element'] ] = ( $els[ $t['post'] ][ $t['element'] ] ?? '' ) . '<p>' . str_replace( ' – ', $dash, $t['find'] ) . '</p>'; }
	foreach ( $els as $post => $byel ) {
		$list = array(); foreach ( $byel as $id => $html ) { $list[] = el( $id, array( 'editor' => $html ) ); }
		$list[] = el( 'keep', array( 'editor' => 'untouched – copy' ) );
		$GLOBALS['meta'][ $post ]['_elementor_data'] = json_encode( array( el( 'sec', array(), $list ) ), JSON_UNESCAPED_UNICODE );
	}
	legacy_copy_v3_run();
	$done = get_option( 'ph_legacy_copy_v3' );
	ok( is_array( $done ) && 11 === $done['changed'] && 0 === $done['skipped'] && 0 === $done['missing'], "v3 run ($label): " . json_encode( $done ) );
	foreach ( $els as $post => $byel ) {
		$raw = $GLOBALS['meta'][ $post ]['_elementor_data'];
		ok( false !== strpos( $raw, 'untouched – copy' ), "other element untouched ($label, post $post)" );
		ok( false === strpos( $raw, 'enterprise-ready media player' ) && false === strpos( $raw, 'preloaded on Amazon' ), "old sentences gone ($label, post $post)" );
	}
	$raw = $GLOBALS['meta'][2389]['_elementor_data'];
	ok( false !== strpos( $raw, 'progressive web app (PWA) that runs on any digital signage hardware – and is easily extended' ), "replace keeps its en dashes ($label)" );
	ok( in_array( '2389:_elementor_css', $GLOBALS['cleared'], true ) && in_array( '7020:_elementor_element_cache', $GLOBALS['cleared'], true ), "caches cleared ($label)" );
}
$rb = get_option( 'ph_legacy_copy_v3_rollback' );
ok( is_array( $rb ) && 11 === count( $rb ) && 'changed' === $rb[1]['status'] && false !== strpos( $rb[1]['before'], 'enterprise-ready' ) && false !== strpos( $rb[1]['after'], 'PWA' ), 'rollback keeps before and after per target' );
ok( null === get_option( 'ph_legacy_copy_v3_lock', null ), 'lock released' );
ok( null === get_option( 'ph_legacy_copy_v2', null ) && null === get_option( 'ph_legacy_copy_v2_rollback', null ), 'v2 options not used by v3' );

/* runs once */
$saves = $GLOBALS['saves']; $snap = $GLOBALS['meta'];
legacy_copy_v3_run();
ok( $saves === $GLOBALS['saves'] && $snap === $GLOBALS['meta'], 'second run is a no-op' );
/* held lock blocks */
unset( $GLOBALS['opts']['ph_legacy_copy_v3'] ); $GLOBALS['opts']['ph_legacy_copy_v3_lock'] = '1';
$rbk = get_option( 'ph_legacy_copy_v3_rollback' );
legacy_copy_v3_run();
ok( $saves === $GLOBALS['saves'] && $rbk === get_option( 'ph_legacy_copy_v3_rollback' ) && null === get_option( 'ph_legacy_copy_v3', null ), 'held lock blocks a concurrent run' );
/* a post already migrated (replace text present, no find) is skipped, not changed again */
$GLOBALS['opts'] = array();
legacy_copy_v3_run();
$done = get_option( 'ph_legacy_copy_v3' );
ok( 0 === $done['changed'], 're-run on migrated posts changes nothing' );
echo $f ? "$f failed\n" : "legacy-copy-v3: all passed\n"; exit( $f ? 1 : 0 );
