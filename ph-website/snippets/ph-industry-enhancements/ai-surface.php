<?php
/**
 * What AI agents and AI search read: robots.txt, the calculator and product tour text in the markdown twins and llms.txt.
 *
 * Nothing here is hand-written per industry. The calculator text is generated from calculators() (calculators.php) and the tour
 * text from TOUR_INDUSTRIES (tour.php), so a twin can never drift from the live calculator or tour. An industry with no entry keeps
 * the text in md.php. Pure PHP apart from the WordPress glue at the bottom, so tests run offline.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_TELCO_MODEL_TEST' ) ) {
	exit;
}

require_once __DIR__ . '/calculators.php';

const PH_AI_SITEMAP = 'https://personalisationhub.com/sitemaps.xml';
/** Crawlers and agents named in robots.txt: search and retrieval bots, user-triggered fetchers and training opt-in tokens. */
const PH_AI_AGENTS = array( 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bingbot' );

/** The tours, from TOUR_INDUSTRIES (tour.php): key => entry. Empty when tour.php is not loaded. */
function ai_tours() {
	return defined( __NAMESPACE__ . '\TOUR_INDUSTRIES' ) ? constant( __NAMESPACE__ . '\TOUR_INDUSTRIES' ) : array();
}

/* ------------------------------------------------------------------ robots.txt */

/**
 * WordPress's robots.txt output, kept as it is, plus the sitemap and one explicit allow group for the named agents.
 * A crawler that matches a named group ignores the "*" group, so the group repeats the "*" group's Disallow lines.
 */
function robots_txt_text( $output, $public = true ) {
	$out = rtrim( (string) $output );
	if ( ! $public ) {
		return $out . "\n"; // "Discourage search engines" is on: say nothing more.
	}
	if ( ! preg_match( '/^\s*Allow:\s*\/\s*$/mi', $out ) ) {
		$out = ( '' === $out ? 'User-agent: *' : $out ) . "\nAllow: /";
	}
	$dis = array();
	if ( preg_match_all( '/^\s*Disallow:\s*(\S.*?)\s*$/mi', $out, $m ) ) {
		foreach ( $m[1] as $d ) {
			$dis[] = 'Disallow: ' . $d;
		}
	}
	if ( ! preg_match( '/^\s*User-agent:\s*GPTBot\s*$/mi', $out ) ) {
		$out .= "\n\n# AI search and assistants: welcome. Markdown versions of every page are at ?format=md; see /llms.txt.\n";
		foreach ( PH_AI_AGENTS as $a ) {
			$out .= 'User-agent: ' . $a . "\n";
		}
		$out .= "Allow: /\n" . ( $dis ? implode( "\n", $dis ) . "\n" : '' );
	}
	if ( ! preg_match( '/^\s*Sitemap:\s*' . preg_quote( PH_AI_SITEMAP, '/' ) . '\s*$/mi', $out ) ) {
		$out = rtrim( $out ) . "\n\nSitemap: " . PH_AI_SITEMAP;
	}
	return rtrim( $out ) . "\n";
}

/* ------------------------------------------------------------------ twins */

/** Replace the "## <heading>" section (up to the next "## " or the end) in $md; null when the section is absent. */
function ai_replace_section( $md, $heading, $new ) {
	$re = '/^## ' . preg_quote( $heading, '/' ) . '[ \t]*\n.*?(?=^## |\z)/ms';
	if ( ! preg_match( $re, $md ) ) {
		return null;
	}
	return preg_replace_callback( $re, function () use ( $new ) {
		return rtrim( $new ) . "\n\n";
	}, $md, 1 );
}

/** The "## Benefits calculator" section for an industry that has a calculators() entry, or ''. */
function ai_calc_section( $key, ?array $cals = null ) {
	$cals = null === $cals ? calculators() : $cals;
	if ( ! isset( $cals[ $key ] ) ) {
		return '';
	}
	$e      = $cals[ $key ];
	$labels = array();
	foreach ( calc_inputs( $e ) as $i ) {
		$labels[] = $i['label'];
	}
	$d  = calc_describe( $key, $e );
	$md = "## Benefits calculator\n" . $e['summary'] . "\n\n"
		. 'Inputs: ' . implode( '; ', $labels ) . ".\n"
		. 'Outcome: ' . $e['outcome'] . "\n";
	if ( $d['downloadFormat'] ) {
		$md .= 'Workbook: ' . $d['downloadNote'] . "\n";
	}
	return $md . 'Open the calculator: ' . calc_link( $e ) . "\n";
}

/** The "## Interactive product tour" section for an industry in TOUR_INDUSTRIES, or ''. */
function ai_tour_section( $key, ?array $tours = null ) {
	$tours = null === $tours ? ai_tours() : $tours;
	if ( ! isset( $tours[ $key ] ) ) {
		return '';
	}
	$t  = $tours[ $key ];
	$md = "## Interactive product tour\nAn interactive product tour for " . $t['name'] . ": three short demos of Personalisation Hub that run in the visitor's own brand, because the tour asks for their company name first.\n\n";
	foreach ( (array) ( $t['demos'] ?? array() ) as $demo ) {
		$md .= '- **' . $demo[0] . ':** ' . $demo[1] . "\n";
	}
	return $md . "\nThe tour is on the page " . PH_CALC_SITE . $t['page'] . ' (section "Interactive product tour"). It asks for the visitor\'s name, company and work email before the three demos play.' . "\n";
}

/** A twin with its calculator section generated and its tour section added. Industries without an entry keep $md as it is. */
function ai_enrich_twin( $key, $md, ?array $cals = null, ?array $tours = null ) {
	$md   = (string) $md;
	$calc = ai_calc_section( $key, $cals );
	if ( '' !== $calc ) {
		$swapped = ai_replace_section( $md, 'Benefits calculator', $calc );
		if ( null !== $swapped ) {
			$md = $swapped;
		} elseif ( preg_match( '/^## FAQ[ \t]*$/m', $md ) ) {
			$md = preg_replace( '/^## FAQ[ \t]*$/m', rtrim( $calc ) . "\n\n## FAQ", $md, 1 );
		}
	}
	$tour = ai_tour_section( $key, $tours );
	if ( '' !== $tour && false === strpos( $md, '## Interactive product tour' ) ) {
		if ( preg_match( '/^## FAQ[ \t]*$/m', $md ) ) {
			$md = preg_replace( '/^## FAQ[ \t]*$/m', rtrim( $tour ) . "\n\n## FAQ", $md, 1 );
		} else {
			$md = rtrim( $md ) . "\n\n" . $tour;
		}
	}
	return $md;
}

/** The markdown twin of an industry page (hub or one of the nine): md.php, enriched from calculators() and TOUR_INDUSTRIES. */
function industry_twin( $key ) {
	$all = data( 'md.php' );
	return isset( $all[ $key ] ) ? ai_enrich_twin( $key, $all[ $key ] ) : null;
}

/* ------------------------------------------------------------------ llms.txt */

/** "## Interactive product tours": one line per TOUR_INDUSTRIES entry. */
function ai_tours_llms_md( ?array $tours = null ) {
	$tours = null === $tours ? ai_tours() : $tours;
	if ( ! $tours ) {
		return '';
	}
	$md = "## Interactive product tours\n\n";
	foreach ( $tours as $key => $t ) {
		$names = array();
		foreach ( (array) ( $t['demos'] ?? array() ) as $demo ) {
			$names[] = $demo[0];
		}
		$md .= '- [' . $t['name'] . '](' . PH_CALC_SITE . $t['page'] . '?format=md): an interactive product tour in the visitor\'s own brand, with three demos: ' . implode( ', ', $names ) . ".\n";
	}
	return $md . "\n";
}

function ai_tours_llms_filter( $text, ?array $tours = null ) {
	$sec = ai_tours_llms_md( $tours );
	if ( '' === $sec || false !== strpos( (string) $text, '## Interactive product tours' ) ) {
		return $text;
	}
	$at = strpos( (string) $text, '## Pricing and trial' );
	return false === $at ? rtrim( (string) $text ) . "\n\n" . rtrim( $sec ) . "\n" : substr( $text, 0, $at ) . $sec . substr( $text, $at );
}

/* ------------------------------------------------------------------ WordPress glue */

if ( function_exists( 'add_filter' ) ) {
	add_filter( 'robots_txt', function ( $output, $public = true ) {
		return robots_txt_text( $output, (bool) $public );
	}, 20, 2 );

	add_filter( 'ph_llms_txt', function ( $text ) {
		return ai_tours_llms_filter( $text );
	}, 26 );
}
