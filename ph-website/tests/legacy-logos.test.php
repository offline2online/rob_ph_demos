<?php
/** php ph-website/tests/legacy-logos.test.php : the one-time Android logo insert into the partner logo ticker (Elementor image-carousel, 9 pages). */
define( 'PH_LEGACY_COPY_TEST', 1 );
$GLOBALS['opts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['cleared'] = array(); $GLOBALS['saves'] = 0; $GLOBALS['cleaned'] = array();
function get_option( $k, $d = false ) { return array_key_exists( $k, $GLOBALS['opts'] ) ? $GLOBALS['opts'][ $k ] : $d; }
function add_option( $k, $v ) { if ( array_key_exists( $k, $GLOBALS['opts'] ) ) { return false; } $GLOBALS['opts'][ $k ] = $v; return true; }
function update_option( $k, $v ) { $GLOBALS['opts'][ $k ] = $v; return true; }
function delete_option( $k ) { unset( $GLOBALS['opts'][ $k ] ); return true; }
function get_post_meta( $id, $k ) { return $GLOBALS['meta'][ $id ][ $k ] ?? ''; }
function update_post_meta( $id, $k, $v ) { if ( '_elementor_data' === $k ) { $GLOBALS['saves']++; $v = stripslashes( $v ); } $GLOBALS['meta'][ $id ][ $k ] = $v; return true; }
function delete_post_meta( $id, $k ) { $GLOBALS['cleared'][] = "$id:$k"; unset( $GLOBALS['meta'][ $id ][ $k ] ); return true; }
function clean_post_cache( $id ) { $GLOBALS['cleaned'][] = $id; }
function wp_slash( $s ) { return addslashes( $s ); }
function wp_json_encode( $d ) { return json_encode( $d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ); }
require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/legacy-copy-v2.php';
require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/legacy-logos.php';
use function AngieSnippets\PhIndustryEnhancements_10063\{legacy_logos_run,legacy_logos_targets,legacy_logos_migrate_data,legacy_logos_rollback_data};
$f = 0;
function ok( $c, $m ) { global $f; if ( ! $c ) { $f++; fwrite( STDERR, "FAIL: $m\n" ); } }
const UP = 'https://personalisationhub.com/wp-content/uploads/';
const ANDROID = 'https://personalisationhub.com/wp-content/uploads/2026/11/Android-logo.webp';
function item( $id, $file, $extra = array() ) { return array_merge( array( 'id' => $id, 'url' => UP . $file, 'alt' => '', 'source' => 'library', 'size' => '' ), $extra ); }
function ticker( $id, $items, $type = 'image-carousel' ) { return array( 'id' => $id, 'elType' => 'widget', 'widgetType' => $type, 'settings' => array( 'carousel' => $items, 'slides_to_show' => '5' ), 'elements' => array() ); }
function page( $children ) { return array( array( 'id' => 'sec', 'elType' => 'container', 'settings' => array(), 'elements' => array( array( 'id' => 'col', 'elType' => 'container', 'settings' => array(), 'elements' => $children ) ) ) ); }
function logos() { return array( item( 101, '2025/01/AWS.png' ), item( 102, '2025/01/ChromeOS-1.png', array( 'source' => 'library', 'size' => 'full' ) ), item( 103, '2025/01/FireTV.png' ) ); }
function carousel_of( $data, $id ) { foreach ( $data as $el ) { if ( ( $el['id'] ?? '' ) === $id ) { return $el['settings']['carousel']; } if ( ! empty( $el['elements'] ) ) { $c = carousel_of( $el['elements'], $id ); if ( null !== $c ) { return $c; } } } return null; }
function mig( $data, $el = 'tick' ) { return legacy_logos_migrate_data( $data, array( array( 'post' => 1, 'element' => $el ) ) ); }

/* targets */
$all = legacy_logos_targets();
ok( 9 === count( $all ), 'nine targets: ' . count( $all ) );
ok( 9 === count( array_unique( array_map( function ( $t ) { return $t['post']; }, $all ) ) ), 'one target per post' );
ok( array( 2389, 7020, 6254, 3973, 3566, 3477, 3266, 3035, 2711 ) === array_column( $all, 'post' ), 'the nine posts from the ticket' );
ok( '78ee9c80' === $all[7]['element'] && '4075c9a' === $all[0]['element'], 'element ids kept as given' );

/* inserted straight after ChromeOS, with the ChromeOS item's other keys */
list( $d, $r, $ch ) = mig( page( array( ticker( 'tick', logos() ) ) ) );
$c = carousel_of( $d, 'tick' );
ok( $ch && 'changed' === $r[0]['status'], 'changed' );
ok( 4 === count( $c ) && 102 === $c[1]['id'] && 10775 === $c[2]['id'] && 103 === $c[3]['id'] && 101 === $c[0]['id'], 'Android inserted right after ChromeOS' );
ok( ANDROID === $c[2]['url'], 'Android url' );
ok( array( 'id', 'url', 'alt', 'source', 'size' ) === array_keys( $c[2] ) && 'full' === $c[2]['size'] && 'library' === $c[2]['source'] && '' === $c[2]['alt'], 'copies every other key of the ChromeOS item, alt left empty' );
ok( logos() === $r[0]['before'] && $c === $r[0]['after'], 'result keeps before and after' );
/* a string id on the ChromeOS item gives a string id */
list( $d ) = mig( page( array( ticker( 'tick', array( item( '102', '2025/01/ChromeOS-1.png' ) ) ) ) ) );
ok( '10775' === carousel_of( $d, 'tick' )[1]['id'], 'string id stays a string' );
/* an alt set on ChromeOS is copied as is (the ticket only asks to leave an empty one empty) */
list( $d ) = mig( page( array( ticker( 'tick', array( item( 102, '2025/01/ChromeOS-1.png', array( 'alt' => 'Runs on ChromeOS' ) ) ) ) ) ) );
ok( 'Runs on ChromeOS' === carousel_of( $d, 'tick' )[1]['alt'], 'existing alt key copied' );
/* other elements untouched */
$keep = ticker( 'other', logos() );
list( $d ) = mig( page( array( $keep, ticker( 'tick', logos() ) ) ) );
ok( logos() === carousel_of( $d, 'other' ), 'another carousel on the page is untouched' );

/* skips */
list( $d, $r, $ch ) = mig( page( array( ticker( 'tick', logos() ) ) ), 'nope' );
ok( ! $ch && 'skipped' === $r[0]['status'] && 'element not found' === $r[0]['reason'], 'missing element is skipped' );
list( $d, $r, $ch ) = mig( page( array( ticker( 'tick', array( item( 101, '2025/01/AWS.png' ) ) ) ) ) );
ok( ! $ch && 'skipped' === $r[0]['status'] && 'ChromeOS item not found' === $r[0]['reason'], 'missing ChromeOS item is skipped' );
list( $d, $r, $ch ) = mig( page( array( ticker( 'tick', logos(), 'image-box' ) ) ) );
ok( ! $ch && 'skipped' === $r[0]['status'], 'non image-carousel is skipped' );
$bad = ticker( 'tick', 'x' );
list( $d, $r, $ch ) = mig( page( array( $bad ) ) );
ok( ! $ch && 'skipped' === $r[0]['status'] && 'settings.carousel is not an array' === $r[0]['reason'], 'non-array setting is skipped' );
$with = logos(); $with[] = item( 10775, '2026/11/Android-logo.webp' );
list( $d, $r, $ch ) = mig( page( array( ticker( 'tick', $with ) ) ) );
ok( ! $ch && 'skipped' === $r[0]['status'] && $with === carousel_of( $d, 'tick' ), 'already has 10775: skipped' );

/* the run: 9 pages, second run a no-op, held lock blocks, rollback restores */
function seed() {
	$GLOBALS['meta'] = array();
	foreach ( legacy_logos_targets() as $t ) {
		$GLOBALS['meta'][ $t['post'] ]['_elementor_data'] = json_encode( page( array( ticker( 'x' . $t['post'], logos() ), ticker( $t['element'], logos() ) ) ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
	}
}
seed();
$orig = $GLOBALS['meta'];
legacy_logos_run();
$done = get_option( 'ph_legacy_logos_v1' );
ok( is_array( $done ) && 9 === $done['applied'] && 0 === $done['skipped'] && 9 === count( $done['results'] ), 'run applies 9: ' . json_encode( $done ) );
ok( null === get_option( 'ph_legacy_logos_v1_lock', null ), 'lock released' );
foreach ( legacy_logos_targets() as $t ) {
	$data = json_decode( $GLOBALS['meta'][ $t['post'] ]['_elementor_data'], true );
	$c    = carousel_of( $data, $t['element'] );
	ok( 4 === count( $c ) && 10775 === $c[2]['id'] && ANDROID === $c[2]['url'], "post {$t['post']} has Android after ChromeOS" );
	ok( logos() === carousel_of( $data, 'x' . $t['post'] ), "post {$t['post']} other carousel untouched" );
	ok( in_array( $t['post'] . ':_elementor_css', $GLOBALS['cleared'], true ) && in_array( $t['post'], $GLOBALS['cleaned'], true ), "post {$t['post']} caches cleared" );
}
$saves = $GLOBALS['saves']; $snap = $GLOBALS['meta'];
legacy_logos_run();
ok( $saves === $GLOBALS['saves'] && $snap === $GLOBALS['meta'], 'second run is a no-op' );
/* even with the done option gone, the data is idempotent */
$rb = get_option( 'ph_legacy_logos_v1_rollback' );
$GLOBALS['opts'] = array();
legacy_logos_run();
$again = get_option( 'ph_legacy_logos_v1' );
ok( 0 === $again['applied'] && 9 === $again['skipped'] && $snap === $GLOBALS['meta'] && $saves === $GLOBALS['saves'], 're-run on migrated posts skips all 9' );
/* held lock */
$GLOBALS['opts'] = array( 'ph_legacy_logos_v1_lock' => '1' );
seed();
legacy_logos_run();
ok( $saves === $GLOBALS['saves'] && null === get_option( 'ph_legacy_logos_v1', null ), 'held lock blocks a concurrent run' );
/* rollback restores the exact before value */
ok( is_array( $rb ) && 9 === count( $rb ), 'rollback has a row per target' );
foreach ( $rb as $row ) {
	$data = json_decode( $snap[ $row['post'] ]['_elementor_data'], true );
	$back = legacy_logos_rollback_data( $data, $row );
	ok( json_decode( $orig[ $row['post'] ]['_elementor_data'], true ) === $back, "rollback restores post {$row['post']} exactly" );
}
/* a post without _elementor_data is skipped, not fatal */
$GLOBALS['opts'] = array(); $GLOBALS['meta'] = array();
legacy_logos_run();
$none = get_option( 'ph_legacy_logos_v1' );
ok( 0 === $none['applied'] && 9 === $none['skipped'], 'no _elementor_data: all skipped' );
echo $f ? "$f failed\n" : "legacy-logos: all passed\n"; exit( $f ? 1 : 0 );
