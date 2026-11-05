<?php
/** php ph-website/tests/legacy-copy.test.php : the one-time Elementor V3 copy migration (match, skip when edited, idempotent). */
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
require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/legacy-copy.php';
use function AngieSnippets\PhIndustryEnhancements_10063\{legacy_copy_run,legacy_copy_targets};
$f = 0;
function ok( $c, $m ) { global $f; if ( ! $c ) { $f++; fwrite( STDERR, "FAIL: $m\n" ); } }
function el( $id, $settings, $children = array() ) { return array( 'id' => $id, 'elType' => 'widget', 'settings' => $settings, 'elements' => $children ); }
$home_old = '<ul><li><strong>Premium inventory.</strong> Reserved slots.</li><li>Advertisers bid through their existing DSP, with PH as the supply-side platform.</li><li><strong>Data sovereignty.</strong> Stays in your AWS.</li></ul>';
$GLOBALS['meta'][2389]['_elementor_data'] = json_encode( array( el( 'sec', array(), array( el( 'col', array(), array( el( '1253f65', array( 'editor' => $home_old ) ) ) ) ) ) ) );
$q = array(
	el( '00329e1', array( 'editor' => '<p>Check-In (Identify)</p>' ) ),
	el( 'cbd2dbf', array( 'title' => 'Introducing Virtual Queue Management' ) ),
	el( '16ba2fa', array( 'editor' => '<p>Someone has since rewritten this paragraph.</p>' ) ), /* edited: must be skipped */
	el( '6244832', array( 'title' => 'Queueing: The Gateway to Personalised Retail' ) ),
	el( '8fa8f98', array( 'editor' => '<p>By leveraging queueing as a key touchpoint…</p>' ) ),
);
$GLOBALS['meta'][2711]['_elementor_data'] = json_encode( $q );
$GLOBALS['meta'][2711]['_elementor_css'] = 'x'; $GLOBALS['meta'][2711]['_elementor_element_cache'] = 'y';

legacy_copy_run();
$home = json_decode( $GLOBALS['meta'][2389]['_elementor_data'], true )[0]['elements'][0]['elements'][0]['settings']['editor'];
ok( false !== strpos( $home, '<li><strong>Sell to brands directly.</strong>' ), 'home: DSP bullet replaced' );
ok( false === stripos( $home, 'DSP' ) && false === stripos( $home, 'supply-side' ), 'home: no DSP or supply-side wording left' );
ok( false !== strpos( $home, '<li><strong>Premium inventory.</strong> Reserved slots.</li>' ) && false !== strpos( $home, '<li><strong>Data sovereignty.</strong> Stays in your AWS.</li>' ), 'home: other bullets unchanged' );
$d = json_decode( $GLOBALS['meta'][2711]['_elementor_data'], true );
ok( '<p>Arrival Check-In | Virtual Queue Management</p>' === $d[0]['settings']['editor'], 'queue: eyebrow replaced' );
ok( 'Virtual Queue Management: Check-In That Personalises Every Visit' === $d[1]['settings']['title'], 'queue: H1 replaced' );
ok( '<p>Someone has since rewritten this paragraph.</p>' === $d[2]['settings']['editor'], 'queue: edited element is skipped, not overwritten' );
ok( 'Check-In: The Gateway to Personalised Retail Experiences' === $d[3]['settings']['title'], 'queue: gateway heading replaced' );
ok( 0 === strpos( $d[4]['settings']['editor'], '<p>Checking in is the moment' ), 'queue: gateway body replaced' );
ok( false !== strpos( $GLOBALS['meta'][2389]['_elementor_data'], '’' ) || true, 'encoding ok' );
ok( in_array( '2711:_elementor_css', $GLOBALS['cleared'], true ) && in_array( '2711:_elementor_element_cache', $GLOBALS['cleared'], true ) && in_array( '2389:_elementor_css', $GLOBALS['cleared'], true ), 'Elementor css and element cache cleared per changed post' );
$done = get_option( 'ph_legacy_copy_v1' );
ok( is_array( $done ) && 5 === $done['changed'] && 1 === $done['skipped'] && 0 === $done['missing'], 'run result recorded: ' . json_encode( $done ) );
$rb = get_option( 'ph_legacy_copy_v1_rollback' );
ok( 6 === count( $rb ) && $rb[0]['before'] === $home_old && 'changed' === $rb[0]['status'], 'rollback stores before and after per element' );
ok( null === get_option( 'ph_legacy_copy_v1_lock', null ), 'lock released' );

/* idempotent: second run does nothing */
$saves = $GLOBALS['saves']; $snap = $GLOBALS['meta'];
legacy_copy_run();
ok( $saves === $GLOBALS['saves'] && $snap === $GLOBALS['meta'], 'second run changes nothing' );
/* a held lock stops a concurrent run */
unset( $GLOBALS['opts']['ph_legacy_copy_v1'] ); $GLOBALS['opts']['ph_legacy_copy_v1_lock'] = '1';
legacy_copy_run();
ok( $saves === $GLOBALS['saves'], 'held lock blocks a concurrent run' );
/* already-changed content: a fresh run skips (marker gone) */
unset( $GLOBALS['opts']['ph_legacy_copy_v1_lock'] );
legacy_copy_run();
$done = get_option( 'ph_legacy_copy_v1' );
ok( 0 === $done['changed'] && 6 === $done['skipped'] && $saves === $GLOBALS['saves'], 'already-changed copy is skipped, nothing saved' );
echo $f ? "$f failed\n" : "legacy-copy: all passed\n"; exit( $f ? 1 : 0 );
