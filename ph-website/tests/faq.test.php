<?php
/**
 * Feature Q&A blocks (ph-agent-endpoint/faq.php). Called from run.php; uses its ok().
 */
define( 'PH_AE_TESTS', true );
require_once dirname( __DIR__ ) . '/snippets/ph-agent-endpoint/faq.php';
use function AngieSnippets\PhAgentEndpoint___ID__\{faq_pages,faq_for,faq_graph,faq_html,faq_answer_text,allow_list,json_ld};

$cat = json_decode( file_get_contents( dirname( __DIR__, 2 ) . '/faq/data/index.json' ), true );
$slugs = array();
foreach ( $cat['articles'] as $a ) {
	$slugs[ $a['slug'] ] = $a['status'];
}
$allowed = allow_list();
$all     = faq_pages();
ok( count( $all ) >= 5, 'faq: at least the five named features have a block' );
foreach ( $all as $id => $f ) {
	ok( isset( $allowed[ $id ] ) && in_array( $allowed[ $id ][1], array( 'feature', 'home' ), true ), "faq: $id is an allow-listed feature (or home) page" );
	ok( ! in_array( $allowed[ $id ][0], array( '/retail-media-platform/' ), true ), "faq: $id is not the old retail media slug" );
	$qn = count( $f['questions'] );
	ok( $qn >= 4 && $qn <= 6, "faq: $id has 4 to 6 questions ($qn)" );
	foreach ( $f['questions'] as $q ) {
		$txt = $q['q'] . ' ' . $q['a'] . ' ' . $q['d'];
		ok( preg_match( '/personali[sz]/i', $txt ) ? stripos( $txt, 'personalization' ) === false && stripos( $txt, 'personalize' ) === false : true, 'faq: personalisation spelled with an S: ' . $q['q'] );
		ok( ! preg_match( '/\b(dsp|programmatic|demand[- ]side)\b/i', $txt ), 'faq: no DSP / programmatic mention: ' . $q['q'] );
		ok( preg_match_all( '/[.!?](\s|$)/', $q['a'] ) <= 2 && strlen( $q['a'] ) > 20, 'faq: direct answer is one or two sentences: ' . $q['q'] );
		ok( count( $q['links'] ) >= 1, 'faq: has a Help Centre link: ' . $q['q'] );
		foreach ( $q['links'] as $l ) {
			ok( preg_match( '#^/support-centre/[a-z0-9-]+/([a-z0-9-]+)/$#', $l[1], $m ) && ( $slugs[ $m[1] ] ?? '' ) === 'published', 'faq: link resolves to a published help article: ' . $l[1] );
		}
	}
}
foreach ( array( 7020, 3566, 6254, 2711, 3035, 3477, 3973, 2389, 3266 ) as $id ) {
	ok( faq_for( $id ) !== null, "faq: page $id has a block" );
}
ok( faq_for( 3266 ) !== null && $allowed[3266][0] === '/white-label-retail-media-platform/', 'faq: the white label retail media platform page has a block' );
ok( faq_for( 7062 ) === null && faq_graph( 7062 ) === null && faq_html( 7062 ) === '', 'faq: legal pages have none' );

$g = faq_graph( 7020 );
$j = json_ld( $g );
$d = json_decode( $j, true );
ok( $d['@type'] === 'FAQPage' && $d['@id'] === 'https://personalisationhub.com/digital-signage/#faq', 'faq: FAQPage with its own @id' );
ok( $d['isPartOf']['@id'] === 'https://personalisationhub.com/digital-signage/#webpage', 'faq: tied to the page node' );
ok( count( $d['mainEntity'] ) === count( faq_for( 7020 )['questions'] ), 'faq: every question is in the JSON-LD' );
ok( stripos( $j, '</script' ) === false, 'faq: JSON-LD cannot close the script tag' );
$html = faq_html( 7020 );
foreach ( faq_for( 7020 )['questions'] as $i => $q ) {
	ok( strpos( $html, htmlspecialchars( $q['q'], ENT_QUOTES ) ) !== false && strpos( $html, htmlspecialchars( $q['a'], ENT_QUOTES ) ) !== false, 'faq: visible block carries question and answer ' . $i );
	ok( strpos( $d['mainEntity'][ $i ]['acceptedAnswer']['text'], $q['a'] ) === 0 && $d['mainEntity'][ $i ]['name'] === $q['q'], 'faq: JSON-LD matches the visible text ' . $i );
}
ok( strpos( $html, '<script' ) === false && strpos( $html, 'position:fixed' ) === false, 'faq: no script, nothing fixed' );

use function AngieSnippets\PhAgentEndpoint___ID__\faq_css;
$css = faq_css();
ok( strpos( $html, 'style=' ) === false && strpos( $html, '<style' ) === false, 'faq: styles live in the scoped stylesheet, not inline' );
ok( strpos( $css, '#169BC2' ) !== false && strpos( $css, '#0F7A9A' ) !== false && strpos( $css, 'text-transform:none' ) !== false, 'faq css: brand teal links, no title-casing' );
ok( strpos( $css, '@media (max-width:767px)' ) !== false && strpos( $css, 'position:fixed' ) === false, 'faq css: mobile rule, nothing fixed' );
ok( strlen( $css ) < 2500, 'faq css: small (design guide s.7)' );
