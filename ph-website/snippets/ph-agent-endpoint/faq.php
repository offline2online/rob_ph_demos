<?php
/**
 * PH Agent Endpoint: feature Q&A blocks. Pure helpers (no WordPress calls), so tests run offline.
 * One block per live feature page: visible HTML, FAQPage JSON-LD and markdown all come from the
 * same data (faq-data.php), so what a crawler reads is exactly what a visitor sees.
 */
namespace AngieSnippets\PhAgentEndpoint___ID__;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_AE_TESTS' ) ) {
	return;
}
if ( ! defined( 'PH_AE_SITE' ) ) {
	define( 'PH_AE_SITE', 'https://personalisationhub.com' );
}

/** page id => [heading, questions]. */
function faq_pages() {
	static $d = null;
	if ( null === $d ) {
		$d = require __DIR__ . '/faq-data.php';
	}
	return is_array( $d ) ? $d : array();
}

/** The block for one page id, or null. */
function faq_for( $id ) {
	$all = faq_pages();
	return isset( $all[ (int) $id ] ) ? $all[ (int) $id ] : null;
}

function faq_page_url( $id ) {
	$list = allow_list();
	return isset( $list[ (int) $id ] ) ? PH_AE_SITE . $list[ (int) $id ][0] : '';
}

/** Plain-text answer used in JSON-LD: direct answer, detail, then the Help Centre links. */
function faq_answer_text( array $q ) {
	$t = $q['a'] . ' ' . $q['d'];
	if ( ! empty( $q['links'] ) ) {
		$parts = array();
		foreach ( $q['links'] as $l ) {
			$parts[] = $l[0] . ' (' . PH_AE_SITE . $l[1] . ')';
		}
		$t .= ' Help Centre: ' . implode( '; ', $parts ) . '.';
	}
	return $t;
}

/** FAQPage JSON-LD graph for a page, or null when it has no block. */
function faq_graph( $id ) {
	$f   = faq_for( $id );
	$url = faq_page_url( $id );
	if ( ! $f || '' === $url ) {
		return null;
	}
	$items = array();
	foreach ( $f['questions'] as $q ) {
		$items[] = array(
			'@type'          => 'Question',
			'name'           => $q['q'],
			'acceptedAnswer' => array(
				'@type' => 'Answer',
				'text'  => faq_answer_text( $q ),
			),
		);
	}
	return array(
		'@context'         => 'https://schema.org',
		'@type'            => 'FAQPage',
		'@id'              => $url . '#faq',
		'url'              => $url,
		'inLanguage'       => 'en',
		'isPartOf'         => array( '@id' => $url . '#webpage' ),
		'about'            => array( '@id' => PH_AE_SITE . '/#software' ),
		'mainEntityOfPage' => array( '@id' => $url . '#webpage' ),
		'mainEntity'       => $items,
	);
}

function faq_esc( $s ) {
	return htmlspecialchars( (string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
}

/** The visible block. Inherits the site's fonts and colours; nothing is fixed-position. */
function faq_html( $id ) {
	$f = faq_for( $id );
	if ( ! $f ) {
		return '';
	}
	$h  = '<section class="ph-faq" id="questions" aria-labelledby="ph-faq-h" style="max-width:1140px;margin:48px auto;padding:0 24px;">';
	$h .= '<h2 id="ph-faq-h">' . faq_esc( $f['heading'] ) . '</h2>';
	foreach ( $f['questions'] as $q ) {
		$h .= '<div class="ph-faq-item" style="margin:0 0 24px;"><h3>' . faq_esc( $q['q'] ) . '</h3>';
		$h .= '<p><strong>' . faq_esc( $q['a'] ) . '</strong></p>';
		$h .= '<p>' . faq_esc( $q['d'] ) . '</p>';
		if ( ! empty( $q['links'] ) ) {
			$a = array();
			foreach ( $q['links'] as $l ) {
				$a[] = '<a href="' . faq_esc( PH_AE_SITE . $l[1] ) . '">' . faq_esc( $l[0] ) . '</a>';
			}
			$h .= '<p>Help Centre: ' . implode( ', ', $a ) . '</p>';
		}
		$h .= '</div>';
	}
	return $h . '</section>';
}
