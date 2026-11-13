<?php
/** php ph-website/tests/legacy-copy-v4.test.php : the 13 Nov copy fixes (retired word, UK spelling, typo, alt text) — each applies once, re-run is a no-op, a missing string is "skipped", rollback restores the exact before value. */
define( 'PH_LEGACY_COPY_TEST', 1 );
error_reporting( E_ALL );

function reset_wp() {
	$GLOBALS['opts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['posts'] = array(); $GLOBALS['cleared'] = array(); $GLOBALS['saves'] = 0;
}
reset_wp();
function get_option( $k, $d = false ) { return array_key_exists( $k, $GLOBALS['opts'] ) ? $GLOBALS['opts'][ $k ] : $d; }
function add_option( $k, $v ) { if ( array_key_exists( $k, $GLOBALS['opts'] ) ) { return false; } $GLOBALS['opts'][ $k ] = $v; return true; }
function update_option( $k, $v ) { $GLOBALS['opts'][ $k ] = $v; return true; }
function delete_option( $k ) { if ( ! array_key_exists( $k, $GLOBALS['opts'] ) ) { return false; } unset( $GLOBALS['opts'][ $k ] ); return true; }
function get_post_meta( $id, $k = '', $single = false ) {
	if ( '' === $k ) { return array_map( function ( $v ) { return array( $v ); }, $GLOBALS['meta'][ $id ] ?? array() ); }
	return $GLOBALS['meta'][ $id ][ $k ] ?? '';
}
function update_post_meta( $id, $k, $v ) { if ( '_elementor_data' === $k ) { $GLOBALS['saves']++; } $GLOBALS['meta'][ $id ][ $k ] = stripslashes( $v ); return true; }
function delete_post_meta( $id, $k ) { $GLOBALS['cleared'][] = "$id:$k"; unset( $GLOBALS['meta'][ $id ][ $k ] ); return true; }
function wp_slash( $s ) { return is_array( $s ) ? array_map( 'wp_slash', $s ) : ( is_string( $s ) ? addslashes( $s ) : $s ); }
function wp_json_encode( $d ) { return json_encode( $d ); }
function get_post_types() { return array( 'post' => 'post', 'page' => 'page', 'attachment' => 'attachment' ); }
function get_post( $id ) { return isset( $GLOBALS['posts'][ $id ] ) ? (object) $GLOBALS['posts'][ $id ] : null; }
function wp_update_post( $arr ) { $id = $arr['ID']; foreach ( $arr as $k => $v ) { if ( 'ID' !== $k ) { $GLOBALS['posts'][ $id ][ $k ] = stripslashes( $v ); } } return $id; }
function get_posts( $a ) {
	$out = array();
	if ( 'attachment' === $a['post_type'] ) {
		foreach ( $GLOBALS['posts'] as $id => $p ) {
			if ( 'attachment' !== $p['post_type'] ) { continue; }
			$alt = $GLOBALS['meta'][ $id ]['_wp_attachment_image_alt'] ?? '';
			if ( isset( $a['meta_query'] ) ) {
				$q = $a['meta_query'][0];
				if ( 'LIKE' === $q['compare'] ? false !== stripos( $alt, $q['value'] ) : $alt === $q['value'] ) { $out[] = $id; }
			} elseif ( isset( $a['s'] ) ) {
				if ( false !== stripos( $p['post_title'] . ' ' . $p['post_excerpt'] . ' ' . $p['post_content'], $a['s'] ) ) { $out[] = $id; }
			} elseif ( isset( $a['title'] ) ) {
				if ( $p['post_title'] === $a['title'] ) { $out[] = $id; }
			}
		}
		return $out;
	}
	foreach ( $GLOBALS['meta'] as $id => $m ) {
		if ( isset( $m['_elementor_data'] ) && in_array( $GLOBALS['posts'][ $id ]['post_type'] ?? 'page', $a['post_type'], true ) ) { $out[] = $id; }
	}
	sort( $out );
	return $out;
}

require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/legacy-copy-v2.php';
require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/legacy-copy-v4.php';
use function AngieSnippets\PhIndustryEnhancements_10063\{legacy_copy_v4_run,legacy_copy_v4_rollback,legacy_copy_v4_maybe_rollback,legacy_copy_v4_rules,legacy_copy_v4_replace_text};

$f = 0;
function ok( $c, $m ) { global $f; if ( ! $c ) { $f++; fwrite( STDERR, "FAIL: $m\n" ); } }
function w( $id, $settings, $children = array() ) { return array( 'id' => $id, 'elType' => 'widget', 'settings' => $settings, 'elements' => $children ); }
function sec( $children ) { return array( array( 'id' => 'sec', 'elType' => 'section', 'settings' => array(), 'elements' => $children ) ); }
function page( $id, $els, $type = 'page' ) { $GLOBALS['posts'][ $id ] = array( 'post_type' => $type, 'post_title' => "Page $id", 'post_excerpt' => '', 'post_content' => '' ); $GLOBALS['meta'][ $id ]['_elementor_data'] = wp_json_encode( $els ); }
function att( $id, $alt, $title, $excerpt = '' ) { $GLOBALS['posts'][ $id ] = array( 'post_type' => 'attachment', 'post_title' => $title, 'post_excerpt' => $excerpt, 'post_content' => '' ); $GLOBALS['meta'][ $id ]['_wp_attachment_image_alt'] = $alt; }
function data( $id ) { return json_decode( $GLOBALS['meta'][ $id ]['_elementor_data'], true ); }
function result( $rule ) { foreach ( get_option( 'ph_legacy_copy_v4' )['results'] as $r ) { if ( $r['rule'] === $rule ) { return $r; } } return null; }

/* text-only replacement: never inside a tag, & matches &amp; */
list( $s, $n ) = legacy_copy_v4_replace_text( '<a href="/omni-channel/">omni-channel retail</a>', 'omni-channel', 'omnichannel' );
ok( '<a href="/omni-channel/">omnichannel retail</a>' === $s && 1 === $n, 'href untouched, text replaced: ' . $s );
list( $s, $n ) = legacy_copy_v4_replace_text( 'Smart staffing &amp; service optimization.', 'staffing & service optimization', 'staffing & service optimisation' );
ok( 'Smart staffing & service optimisation.' === $s && 1 === $n, '&amp; matches &: ' . $s );

/* fixtures: one page per ticket item, the pricing table on several pages and in a Theme Builder template */
$before = array();
function fixtures() {
	page( 9001, sec( array( w( 'q1', array( 'editor' => '<p>Franchised or company-owned, every restaurant runs from one secure platform.</p>' ) ) ) ) ); // /industries/qsr/
	foreach ( array( 2389, 7020, 7100, 7200 ) as $id ) {
		page( $id, sec( array( w( 'p' . $id, array( 'price_list' => array( array( 'item_title' => 'Base Platform License', 'item_description' => 'Per store' ) ), 'link' => array( 'url' => 'https://example.com/license/' ) ) ) ) ) );
	}
	page( 7300, sec( array( w( 't1', array( 'title' => 'BASE PLATFORM LICENSE' ) ) ) ), 'elementor_library' );
	page( 9002, sec( array( w( 'rq', array( 'editor' => '<ul><li>Insights for staffing &amp; service optimization</li></ul>' ) ) ) ) ); // /retail-queue-management/
	page( 9003, sec( array( w( 'am', array( 'title' => 'An omni-channel network', 'editor' => '<p>Go <a href="https://x.test/omni-channel">omni-channel</a> today.</p>' ) ) ) ) ); // /amazon-signage/
	page( 9004, sec( array( w( 'im', array( 'image' => array( 'url' => 'https://p.test/personalized.jpg', 'id' => 501, 'alt' => 'personalized' ) ) ) ) ) ); // /store-sites/
	page( 9005, sec( array( w( 'quote', array( 'editor' => '<p>Report: “State of Personalization in Retail”.</p>' ) ) ) ) );
	att( 501, 'personalized', 'personalized' );
	att( 600, 'Automated Personalisation, Continually Maximising Revenie', 'Home social image', 'Maximising Revenie' );
	att( 700, 'Unrelated', 'Untouched' );
	$GLOBALS['opts']['page_on_front'] = 2389;
	$GLOBALS['meta'][2389]['_seopress_social_fb_title'] = 'Personalisation Hub';
	$GLOBALS['meta'][2389]['_seopress_titles_desc'] = 'An omni-channel platform. Base Platform License included.';
	$GLOBALS['opts']['seopress_social_option_name'] = array( 'seopress_social_knowledge_name' => 'Personalisation Hub', 'seopress_social_facebook_img_alt' => 'Continually Maximising Revenie' );
}
fixtures();
$snap_meta = $GLOBALS['meta']; $snap_posts = $GLOBALS['posts']; $snap_social = $GLOBALS['opts']['seopress_social_option_name'];

legacy_copy_v4_run();
$done = get_option( 'ph_legacy_copy_v4' );
ok( is_array( $done ) && 6 === $done['changed'] && 0 === $done['skipped'], 'every rule applied: ' . json_encode( array( $done['changed'] ?? null, $done['skipped'] ?? null ) ) );
ok( null === get_option( 'ph_legacy_copy_v4_lock', null ), 'lock released' );

/* 1. retired word */
ok( '<p>Owner-operated or company-owned, every restaurant runs from one secure platform.</p>' === data( 9001 )[0]['elements'][0]['settings']['editor'], 'QSR line reworded' );
ok( 1 === result( 'qsr-retired-word' )['count'], 'QSR counted once' );
/* 2. licence on every pricing page and the template; link URL untouched */
foreach ( array( 2389, 7020, 7100, 7200 ) as $id ) {
	$st = data( $id )[0]['elements'][0]['settings'];
	ok( 'Base Platform Licence' === $st['price_list'][0]['item_title'], "Licence on $id" );
	ok( 'https://example.com/license/' === $st['link']['url'], "link URL kept on $id" );
}
ok( 'BASE PLATFORM LICENCE' === data( 7300 )[0]['elements'][0]['settings']['title'], 'upper-case variant in Theme Builder template' );
ok( 'An omni-channel platform. Base Platform License included.' !== $GLOBALS['meta'][2389]['_seopress_titles_desc'] && 'An omnichannel platform. Base Platform Licence included.' === $GLOBALS['meta'][2389]['_seopress_titles_desc'], 'SEOPress description fixed' );
ok( 6 === result( 'licence-uk-spelling' )['count'], 'licence count 6: ' . result( 'licence-uk-spelling' )['count'] );
/* 3. optimisation */
ok( '<ul><li>Insights for staffing & service optimisation</li></ul>' === data( 9002 )[0]['elements'][0]['settings']['editor'], 'optimisation' );
/* 4. omnichannel, href kept */
$st = data( 9003 )[0]['elements'][0]['settings'];
ok( 'An omnichannel network' === $st['title'] && '<p>Go <a href="https://x.test/omni-channel">omnichannel</a> today.</p>' === $st['editor'], 'omnichannel, href kept' );
/* 5. Revenie: attachment alt, caption and the SEOPress social option */
ok( 'Automated Personalisation, Continually Maximising Revenue' === $GLOBALS['meta'][600]['_wp_attachment_image_alt'], 'og:image:alt source fixed' );
ok( 'Maximising Revenue' === $GLOBALS['posts'][600]['post_excerpt'], 'caption fixed' );
ok( 'Continually Maximising Revenue' === get_option( 'seopress_social_option_name' )['seopress_social_facebook_img_alt'], 'SEOPress option fixed' );
/* 6. /store-sites/ image: attachment alt and title, and the widget's own alt */
ok( 'Personalised campaign targeting' === $GLOBALS['meta'][501]['_wp_attachment_image_alt'] && 'Personalised campaign targeting' === $GLOBALS['posts'][501]['post_title'], 'attachment alt and title' );
ok( 'Personalised campaign targeting' === data( 9004 )[0]['elements'][0]['settings']['image']['alt'], 'widget alt' );
ok( 'https://p.test/personalized.jpg' === data( 9004 )[0]['elements'][0]['settings']['image']['url'], 'image URL kept' );
ok( 'Unrelated' === $GLOBALS['meta'][700]['_wp_attachment_image_alt'] && 'Untouched' === $GLOBALS['posts'][700]['post_title'], 'other attachment untouched' );
/* quoted third-party name left as is, but reported as residue */
ok( false !== strpos( data( 9005 )[0]['elements'][0]['settings']['editor'], 'State of Personalization in Retail' ), 'quoted report title untouched' );
$res = $done['residue'];
ok( 1 === count( $res ) && 9005 === $res[0]['post'] && 'Personalization' === $res[0]['term'], 'residue lists only the quoted title: ' . json_encode( $res ) );
/* caches cleared on changed posts only */
ok( in_array( '9001:_elementor_css', $GLOBALS['cleared'], true ) && in_array( '7300:_elementor_element_cache', $GLOBALS['cleared'], true ) && ! in_array( '9005:_elementor_css', $GLOBALS['cleared'], true ), 'caches cleared for changed posts only' );

/* re-run is a no-op */
$saves = $GLOBALS['saves']; $m = $GLOBALS['meta']; $p = $GLOBALS['posts']; $o = $GLOBALS['opts'];
legacy_copy_v4_run();
ok( $saves === $GLOBALS['saves'] && $m === $GLOBALS['meta'] && $p === $GLOBALS['posts'] && $o === $GLOBALS['opts'], 'second run is a no-op' );
/* held lock blocks a concurrent run */
$keep = $GLOBALS['opts']; unset( $GLOBALS['opts']['ph_legacy_copy_v4'] ); $GLOBALS['opts']['ph_legacy_copy_v4_lock'] = '1';
legacy_copy_v4_run();
ok( $saves === $GLOBALS['saves'] && null === get_option( 'ph_legacy_copy_v4', null ), 'held lock blocks' );
/* forced re-run on migrated content: every rule reported skipped, nothing saved */
$rb_keep = $keep['ph_legacy_copy_v4_rollback'];
$GLOBALS['opts'] = $keep; unset( $GLOBALS['opts']['ph_legacy_copy_v4'] );
legacy_copy_v4_run();
$again = get_option( 'ph_legacy_copy_v4' );
ok( 0 === $again['changed'] && 6 === $again['skipped'] && $saves === $GLOBALS['saves'], 'migrated content: every rule skipped, nothing saved' );
ok( 'skipped' === result( 'qsr-retired-word' )['status'] && '' !== result( 'qsr-retired-word' )['reason'], 'skipped rule has a reason' );
$GLOBALS['opts'] = $keep;

/* rollback restores the exact before values */
$GLOBALS['opts']['ph_legacy_copy_v4_rollback_request'] = 1;
legacy_copy_v4_maybe_rollback();
$rr = get_option( 'ph_legacy_copy_v4_rollback_result' );
ok( is_array( $rr ) && 0 === count( $rr['conflicts'] ) && $rr['restored'] === count( $rb_keep ), 'rollback restored all: ' . json_encode( $rr ) );
ok( null === get_option( 'ph_legacy_copy_v4_rollback_request', null ), 'rollback request cleared' );
foreach ( $snap_meta as $id => $mm ) {
	foreach ( $mm as $k => $v ) {
		if ( '_elementor_data' === $k ) {
			ok( json_decode( $v, true ) === data( $id ), "elementor data of $id restored exactly" );
		} else {
			ok( $v === $GLOBALS['meta'][ $id ][ $k ], "meta $id:$k restored exactly" );
		}
	}
}
ok( $snap_posts === $GLOBALS['posts'], 'post fields restored exactly' );
ok( $snap_social === get_option( 'seopress_social_option_name' ), 'SEOPress option restored exactly' );
/* a value edited after the migration is not overwritten by rollback */
reset_wp(); fixtures(); legacy_copy_v4_run();
$els = data( 9001 ); $els[0]['elements'][0]['settings']['editor'] = '<p>Edited by hand.</p>'; $GLOBALS['meta'][9001]['_elementor_data'] = wp_json_encode( $els );
$rr = legacy_copy_v4_rollback();
ok( 1 === count( $rr['conflicts'] ) && 9001 === $rr['conflicts'][0]['post'] && '<p>Edited by hand.</p>' === data( 9001 )[0]['elements'][0]['settings']['editor'], 'hand edit kept, reported as conflict' );

/* a site where none of the strings exist: every rule skipped, no write */
reset_wp(); page( 1, sec( array( w( 'a', array( 'editor' => '<p>Clean copy.</p>' ) ) ) ) );
legacy_copy_v4_run();
$d = get_option( 'ph_legacy_copy_v4' );
ok( 0 === $d['changed'] && 6 === $d['skipped'] && 0 === $GLOBALS['saves'] && array() === get_option( 'ph_legacy_copy_v4_rollback' ), 'clean site: all skipped, nothing written' );

echo $f ? "$f failed\n" : "legacy-copy-v4: all passed\n"; exit( $f ? 1 : 0 );
