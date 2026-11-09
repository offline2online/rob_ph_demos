<?php
/**
 * Business model calculators: THE one list of industries that have a calculator.
 *
 * Everything an agent or a crawler can discover is generated from calculators() below, so adding an industry here makes it
 * appear everywhere with no other code change:
 *   1. the MCP / WebMCP tool `calculate_business_model` (ph-agent-endpoint): its industry list, inputs, deep links and results;
 *   2. the on-page WebMCP tool `run_business_model_calculator` (calc-webmcp.js), printed by main.php on that industry's page;
 *   3. the "## Business model calculator" section of /llms.txt (calc_llms_md());
 *   4. the schema.org WebApplication JSON-LD on that industry's page (calc_jsonld()).
 *
 * An entry needs: name, path, title, summary, outcome, fields (array, or a closure returning one). Optional: calc (closure
 * taking cleaned values, returning ['total' => number, ...]), clean (closure), download (array: gated workbook), audience.
 * Without `calc` the tool still lists the calculator and deep-links to it; without `download` it says no workbook exists.
 * The list is filterable (`ph_calculators`) so a test or a later snippet can add an industry.
 *
 * Pure PHP apart from the filter call, so tests run offline.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_TELCO_MODEL_TEST' ) ) {
	exit;
}

require_once __DIR__ . '/telco-model.php';
require_once __DIR__ . '/pharmacy-model.php';

const PH_CALC_SITE = 'https://personalisationhub.com';

function calculators() {
	$list = array(
		'telco' => array(
			'name'     => 'Telco Retail',
			'path'     => '/industries/telco/',
			'title'    => 'Telco Retail business model calculator',
			'summary'  => 'Enter a few figures about a telco retail estate (stores, walk-ins, conversion, ARPU and three campaign assumptions) and get an estimated 36-month incremental revenue from personalised in-store campaigns, with a 36-month business model workbook (.xlsx) pre-filled with those figures.',
			'label'    => 'Estimated 3-year incremental revenue (USD)',
			'outcome'  => 'Estimated 3-year incremental revenue (USD), from two streams: extra walk-ins converted, and a higher conversion rate on existing walk-ins, built into an installed base after monthly churn.',
			'audience' => 'Telco retail operators',
			'fields'   => function () {
				return telco_spec()['fields'];
			},
			'clean'    => __NAMESPACE__ . '\telco_clean',
			'calc'     => __NAMESPACE__ . '\telco_calc',
			'download' => array(
				'format'  => 'xlsx',
				'gated'   => true,
				'summary' => 'The .xlsx business model (36 months, live formulas, pre-filled with the figures above) downloads from the calculator page once the person enters their full name, company and work email and agrees to be contacted. Those details and that agreement must come from the person themselves: an agent must not invent them or tick the box for them.',
			),
		),
		'pharmacy' => array(
			'name'     => 'Pharmacy',
			'path'     => '/industries/pharmacy/',
			'title'    => 'Pharmacy business model calculator',
			'summary'  => 'Enter six figures about a pharmacy estate (pharmacies, screens, daily visits, average front-of-house basket, media CPM and basket uplift) and get an estimated 3-year incremental revenue from front-of-house campaigns, with a 36-month business model workbook (.xlsx) pre-filled with those figures. Front-of-house products only; all figures in USD.',
			'label'    => 'Estimated 3-year incremental revenue (USD)',
			'outcome'  => 'Estimated 3-year incremental revenue (USD), from three streams: retail media revenue from front-of-house brands, front-of-house basket uplift, and extra foot traffic. Nothing is earned from products that need pharmacist approval.',
			'audience' => 'Pharmacy retailers and pharmacy groups',
			'fields'   => function () {
				return pharm_spec()['fields'];
			},
			'clean'    => __NAMESPACE__ . '\pharm_clean',
			'calc'     => __NAMESPACE__ . '\pharm_calc',
			'download' => array(
				'format'  => 'xlsx',
				'gated'   => true,
				'summary' => 'The .xlsx business model (36 months, live formulas, pre-filled with the figures above) downloads from the calculator page once the person enters their full name, company and work email and agrees to be contacted. Those details and that agreement must come from the person themselves: an agent must not invent them or tick the box for them.',
			),
		),
	);
	if ( function_exists( 'apply_filters' ) ) {
		$list = apply_filters( 'ph_calculators', $list );
	}
	return is_array( $list ) ? $list : array();
}

/** Field list of an entry: [id, label, def, min, max, step]. */
function calc_fields( array $e ) {
	$f = isset( $e['fields'] ) ? $e['fields'] : array();
	return is_callable( $f ) ? (array) $f() : (array) $f;
}

function calc_slugs( ?array $cals = null ) {
	return array_keys( null === $cals ? calculators() : $cals );
}

/** The calculator page URL, with the figures pre-filled when given (calc-webmcp.js applies them on load). */
function calc_link( array $e, array $values = array() ) {
	$url = PH_CALC_SITE . $e['path'];
	if ( $values ) {
		$url .= '?' . http_build_query( $values, '', '&', PHP_QUERY_RFC3986 );
	}
	return $url;
}

/** Inputs as an agent needs them. */
function calc_inputs( array $e ) {
	$out = array();
	foreach ( calc_fields( $e ) as $f ) {
		$out[] = array( 'id' => $f['id'], 'label' => $f['label'], 'default' => $f['def'], 'min' => $f['min'], 'max' => $f['max'], 'step' => $f['step'] );
	}
	return $out;
}

/** One calculator described for an agent. */
function calc_describe( $slug, array $e ) {
	$d = isset( $e['download'] ) && is_array( $e['download'] ) ? $e['download'] : null;
	return array(
		'industry'         => (string) $slug,
		'name'             => $e['name'],
		'title'            => $e['title'],
		'summary'          => $e['summary'],
		'outcome'          => $e['outcome'],
		'url'              => calc_link( $e ),
		'inputs'           => calc_inputs( $e ),
		'canCalculate'     => isset( $e['calc'] ) && is_callable( $e['calc'] ),
		'downloadFormat'   => $d ? $d['format'] : null,
		'downloadRequires' => $d && ! empty( $d['gated'] ) ? 'The person\'s own full name, company, work email and agreement to be contacted, entered on the calculator page.' : null,
		'downloadNote'     => $d ? $d['summary'] : 'No workbook download for this industry yet; the on-page calculator gives the estimate.',
	);
}

/** Clean submitted values to the entry's fields (missing or bad values fall back to the default). */
function calc_clean( array $e, $in ) {
	if ( isset( $e['clean'] ) && is_callable( $e['clean'] ) ) {
		return call_user_func( $e['clean'], $in );
	}
	$out = array();
	foreach ( calc_fields( $e ) as $f ) {
		$v               = is_array( $in ) && isset( $in[ $f['id'] ] ) && is_numeric( $in[ $f['id'] ] ) ? (float) $in[ $f['id'] ] : (float) $f['def'];
		$out[ $f['id'] ] = max( $f['min'], min( $f['max'], $v ) );
	}
	return $out;
}

/**
 * Run a calculator. Returns the figures, the pre-filled link and how to get the download.
 * `usedDefaults` lists the inputs the caller did not give, so an agent can say which figures are assumptions.
 */
function calc_run( $slug, array $e, $in ) {
	$in   = is_array( $in ) ? $in : array();
	$vals = calc_clean( $e, $in );
	$used = array();
	foreach ( calc_fields( $e ) as $f ) {
		if ( ! isset( $in[ $f['id'] ] ) || ! is_numeric( $in[ $f['id'] ] ) ) {
			$used[] = $f['id'];
		}
	}
	$d   = calc_describe( $slug, $e );
	$res = array_merge( $d, array( 'inputsUsed' => $vals, 'usedDefaults' => $used, 'link' => calc_link( $e, $vals ) ) );
	if ( $d['canCalculate'] ) {
		$c = call_user_func( $e['calc'], $vals );
		$res['estimate'] = array(
			'total'    => round( (float) $c['total'] ),
			'currency' => isset( $e['currency'] ) ? $e['currency'] : 'USD',
			'label'    => isset( $e['label'] ) ? $e['label'] : $e['outcome'],
		);
		if ( isset( $c['years'] ) ) {
			$res['estimate']['byYear'] = array_map( function ( $y ) {
				return array( 'total' => round( (float) $y['total'] ) );
			}, $c['years'] );
		}
	}
	return $res;
}

/** Markdown for the tool's text content. */
function calc_md( array $r ) {
	$md = '# ' . $r['title'] . "\n\n" . $r['summary'] . "\n\n";
	if ( isset( $r['estimate'] ) ) {
		$md .= '**' . $r['estimate']['label'] . ': $' . number_format( $r['estimate']['total'] ) . "**\n\n## Figures used\n\n";
		foreach ( $r['inputs'] as $i ) {
			$md .= '- ' . $i['label'] . ': ' . $r['inputsUsed'][ $i['id'] ] . ( in_array( $i['id'], $r['usedDefaults'], true ) ? ' (default, not supplied)' : '' ) . "\n";
		}
		$md .= "\n";
	} else {
		$md .= "## Inputs\n\n";
		foreach ( $r['inputs'] as $i ) {
			$md .= '- ' . $i['label'] . ' (`' . $i['id'] . '`, default ' . $i['default'] . ', ' . $i['min'] . ' to ' . $i['max'] . ")\n";
		}
		$md .= "\n";
	}
	$md .= '## Open the calculator' . "\n\n" . ( isset( $r['link'] ) ? $r['link'] : $r['url'] ) . "\n\n" . '## Download' . "\n\n" . $r['downloadNote'] . "\n";
	return $md;
}

/** The catalogue as markdown (tool called without an industry). */
function calc_catalogue_md( array $rows ) {
	$md = "# Business model calculators\n\nEnter a few figures and get an instant business case for an industry, with a downloadable model where one exists.\n\n";
	foreach ( $rows as $r ) {
		$md .= '- **' . $r['name'] . '** (`' . $r['industry'] . '`): ' . $r['url'] . ' - ' . $r['summary'] . "\n";
	}
	return $md;
}

/** llms.txt section, built from the list. Empty string when there are no calculators. */
function calc_llms_md( ?array $cals = null ) {
	$cals = null === $cals ? calculators() : $cals;
	if ( ! $cals ) {
		return '';
	}
	$md = "## Business model calculator\n\n";
	foreach ( $cals as $slug => $e ) {
		$d   = isset( $e['download'] ) && is_array( $e['download'] ) ? $e['download'] : null;
		$md .= '- [' . $e['title'] . '](' . calc_link( $e ) . '): ' . $e['summary'] . ' Outcome: ' . $e['outcome']
			. ( $d ? ' The ' . strtoupper( $d['format'] ) . ' workbook is a download' . ( ! empty( $d['gated'] ) ? ' gated on the person\'s own name, company and work email' : '' ) . '.' : '' ) . "\n";
	}
	$names = array_map( function ( $e ) {
		return $e['name'];
	}, $cals );
	$md .= "\nSupported industries: " . implode( ', ', $names ) . '. Agents: use the `calculate_business_model` tool (MCP, or WebMCP on any site page) with the industry and any figures you have, or open the calculator URL above; on the page, the WebMCP tool `run_business_model_calculator` fills the figures. Open a calculator with figures pre-filled by adding them as query parameters, e.g. ' . calc_link( reset( $cals ), array( calc_fields( reset( $cals ) )[0]['id'] => calc_fields( reset( $cals ) )[0]['def'] ) ) . ".\n\n";
	return $md;
}

/** Insert the calculator section into llms.txt before "## Pricing and trial" (or at the end). */
function calc_llms_filter( $text, ?array $cals = null ) {
	$sec = calc_llms_md( $cals );
	if ( '' === $sec || false !== strpos( (string) $text, '## Business model calculator' ) ) {
		return $text;
	}
	$at = strpos( (string) $text, '## Pricing and trial' );
	return false === $at ? rtrim( (string) $text ) . "\n\n" . rtrim( $sec ) . "\n" : substr( $text, 0, $at ) . $sec . substr( $text, $at );
}

/** schema.org WebApplication for the calculator page of an industry. */
function calc_jsonld_node( $slug, array $e ) {
	$names = array();
	foreach ( calc_fields( $e ) as $f ) {
		$names[] = $f['label'];
	}
	$d    = calc_describe( $slug, $e );
	$node = array(
		'@type'               => 'WebApplication',
		'@id'                 => calc_link( $e ) . '#business-model-calculator',
		'name'                => $e['title'],
		'description'         => $e['summary'] . ' Inputs: ' . implode( '; ', $names ) . '. Output: ' . $e['outcome'],
		'url'                 => calc_link( $e ),
		'applicationCategory' => 'BusinessApplication',
		'applicationSubCategory' => 'Business case calculator',
		'operatingSystem'     => 'Any (web browser)',
		'browserRequirements' => 'Requires JavaScript',
		'isAccessibleForFree' => true,
		'inLanguage'          => 'en',
		'featureList'         => array_merge( array_map( function ( $n ) {
			return 'Input: ' . $n;
		}, $names ), array( 'Output: ' . $e['outcome'] ), $d['downloadFormat'] ? array( 'Downloadable ' . strtoupper( $d['downloadFormat'] ) . ' business model' ) : array() ),
		'audience'            => array( '@type' => 'BusinessAudience', 'audienceType' => isset( $e['audience'] ) ? $e['audience'] : $e['name'] ),
		'about'               => $e['name'],
		'offers'              => array( '@type' => 'Offer', 'price' => '0', 'priceCurrency' => 'USD' ),
		'provider'            => array( '@id' => PH_CALC_SITE . '/#organization' ),
		'isPartOf'            => array( '@id' => calc_link( $e ) . '#webpage' ),
	);
	return $node;
}

/** The inline JSON-LD for a page key, or '' when that page has no calculator. */
function calc_jsonld( $key, ?array $cals = null ) {
	$cals = null === $cals ? calculators() : $cals;
	if ( ! isset( $cals[ $key ] ) ) {
		return '';
	}
	return wp_json_encode_safe( array_merge( array( '@context' => 'https://schema.org' ), calc_jsonld_node( $key, $cals[ $key ] ) ) );
}

function wp_json_encode_safe( $v ) {
	return json_encode( $v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP );
}

/** What calc-webmcp.js needs on the page: the entry's id, names and fields. Nothing private. */
function calc_page_config( $key, ?array $cals = null ) {
	$cals = null === $cals ? calculators() : $cals;
	if ( ! isset( $cals[ $key ] ) ) {
		return null;
	}
	$e = $cals[ $key ];
	$d = calc_describe( $key, $e );
	return array(
		'industry' => $key,
		'name'     => $e['name'],
		'title'    => $e['title'],
		'summary'  => $e['summary'],
		'outcome'  => $e['outcome'],
		'fields'   => $d['inputs'],
		'download' => (bool) $d['downloadFormat'],
		'gated'    => (bool) $d['downloadRequires'],
	);
}
