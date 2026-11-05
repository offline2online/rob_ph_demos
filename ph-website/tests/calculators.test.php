<?php
/**
 * php ph-website/tests/calculators.test.php
 * The business model calculator is discoverable four ways (MCP tool, WebMCP page tool, llms.txt, schema.org), all generated
 * from the one list in ph-industry-enhancements/calculators.php. Adding an industry to that list must surface it in all four
 * with no code change; this test adds a test industry through the `ph_calculators` filter and checks exactly that.
 */
error_reporting( E_ALL );
define( 'ABSPATH', __DIR__ );
define( 'PH_TELCO_MODEL_TEST', 1 );
$f = 0;
function ok( $c, $m ) { global $f; if ( ! $c ) { $f++; fwrite( STDERR, "FAIL: $m\n" ); } }
$extra = array();
function apply_filters( $tag, $v ) { global $extra; return 'ph_calculators' === $tag ? array_merge( $v, $extra ) : $v; }
function wp_json_encode( $v, $o = 0 ) { return json_encode( $v, $o ); }

$snip = dirname( __DIR__ ) . '/snippets';
require $snip . '/ph-industry-enhancements/calculators.php';
require $snip . '/ph-agent-endpoint/lib.php';
require $snip . '/ph-agent-endpoint/tools.php';
use function AngieSnippets\PhIndustryEnhancements_10063\{calculators,calc_llms_filter,calc_jsonld,calc_page_config,calc_run,calc_describe};
use function AngieSnippets\PhAgentEndpoint___ID__\{tool_defs,run_tool};

function tool( $a ) { return run_tool( 'calculate_business_model', $a, array() ); }
function tooldef() { foreach ( tool_defs() as $d ) { if ( 'calculate_business_model' === $d['name'] ) { return $d; } } return null; }
$llms = "# PH\n\n## Industries\n\n- x\n\n## Pricing and trial\n\n- y\n";

/* 1. Telco Retail today */
$d = tooldef();
ok( $d && true === $d['annotations']['readOnlyHint'] && $d['inputSchema']['properties']['industry']['enum'] === array( 'telco' ), 'tool listed with telco only' );
ok( false !== strpos( $d['description'], 'Telco Retail' ) && false !== strpos( $d['description'], 'instant' ), 'description names Telco Retail and the instant result' );
$cat = tool( array() );
ok( empty( $cat['isError'] ) && 'telco' === $cat['structuredContent']['calculators'][0]['industry'] && count( $cat['structuredContent']['calculators'][0]['inputs'] ) === 7, 'no arguments lists the calculators and their 7 inputs' );
$r = tool( array( 'industry' => 'telco', 'inputs' => array( 'stores' => 120, 'arpu' => 60 ) ) );
$s = $r['structuredContent'];
ok( empty( $r['isError'] ) && $s['estimate']['total'] > 0 && 120.0 === $s['inputsUsed']['stores'] && in_array( 'churn', $s['usedDefaults'], true ) && ! in_array( 'stores', $s['usedDefaults'], true ), 'estimate with supplied figures and named defaults' );
ok( 0 === strpos( $s['link'], 'https://personalisationhub.com/industries/telco/?stores=120' ) && false !== strpos( $s['link'], 'arpu=60' ), 'deep link carries the figures' );
ok( 'xlsx' === $s['downloadFormat'] && false !== strpos( $s['downloadRequires'], 'own full name' ), 'download is described and stays gated on the person' );
ok( abs( $s['estimate']['total'] - round( AngieSnippets\PhIndustryEnhancements_10063\telco_calc( AngieSnippets\PhIndustryEnhancements_10063\telco_clean( array( 'stores' => 120, 'arpu' => 60 ) ) )['total'] ) ) < 1, 'estimate equals the on-page model' );
ok( ! empty( tool( array( 'industry' => 'pharmacy' ) )['isError'] ), 'unsupported industry is a plain error' );
ok( ! empty( tool( array( 'industry' => 'telco', 'inputs' => array( 'evil' => 1 ) ) )['isError'] ), 'unknown input rejected' );
ok( ! empty( tool( array( 'industry' => 'telco', 'inputs' => array( 'stores' => 'a' ) ) )['isError'] ), 'non-numeric input rejected' );
ok( ! empty( tool( array( 'inputs' => array( 'stores' => 5 ) ) )['isError'] ), 'inputs without an industry rejected' );
ok( 5000 == tool( array( 'industry' => 'telco', 'inputs' => array( 'stores' => 99999 ) ) )['structuredContent']['inputsUsed']['stores'], 'values clamp to the field range' );
$ll = calc_llms_filter( $llms );
ok( 1 === substr_count( $ll, '## Business model calculator' ) && strpos( $ll, '## Business model calculator' ) < strpos( $ll, '## Pricing and trial' ) && false !== strpos( $ll, 'https://personalisationhub.com/industries/telco/' ) && false !== strpos( $ll, 'Supported industries: Telco Retail' ), 'llms.txt section lists the calculator, industries and URL' );
ok( calc_llms_filter( $ll ) === $ll, 'llms.txt section is not added twice' );
$j = json_decode( calc_jsonld( 'telco' ), true );
ok( 'WebApplication' === $j['@type'] && 'https://schema.org' === $j['@context'] && 'BusinessApplication' === $j['applicationCategory'] && true === $j['isAccessibleForFree'], 'JSON-LD is a WebApplication' );
ok( false !== strpos( $j['description'], 'Number of stores' ) && false !== stripos( $j['description'], 'telco retail' ) && 'Telco Retail' === $j['about'] && count( $j['featureList'] ) >= 8, 'JSON-LD describes the inputs and the industry' );
ok( '' === calc_jsonld( 'pharmacy' ) && '' === calc_jsonld( '' ), 'no JSON-LD on a page without a calculator' );
ok( false === stripos( calc_jsonld( 'telco' ), '</script' ), 'JSON-LD cannot close the script tag' );
$cfg = calc_page_config( 'telco' );
ok( 'telco' === $cfg['industry'] && 7 === count( $cfg['fields'] ) && $cfg['download'] && $cfg['gated'] && null === calc_page_config( 'qsr' ), 'page config for the WebMCP script' );

/* 2. Add a test industry: it must appear in all four places with no code change */
$extra = array( 'zztest' => array(
	'name' => 'Zz Test Retail', 'path' => '/industries/zztest/', 'title' => 'Zz Test Retail business model calculator',
	'summary' => 'A test calculator.', 'outcome' => 'Estimated test revenue', 'label' => 'Estimated test revenue (USD)',
	'fields' => array( array( 'id' => 'units', 'label' => 'Number of units', 'def' => 10, 'min' => 1, 'max' => 100, 'step' => 1 ) ),
	'calc' => function ( $v ) { return array( 'total' => $v['units'] * 1000 ); },
) );
$d2 = tooldef();
ok( $d2['inputSchema']['properties']['industry']['enum'] === array( 'telco', 'zztest' ) && false !== strpos( $d2['description'], 'Zz Test Retail' ) && isset( $d2['inputSchema']['properties']['inputs']['properties']['units'] ), 'new industry: MCP tool lists it and its input' );
$r2 = tool( array( 'industry' => 'zztest', 'inputs' => array( 'units' => 20 ) ) );
ok( empty( $r2['isError'] ) && 20000 === (int) $r2['structuredContent']['estimate']['total'] && false !== strpos( $r2['structuredContent']['link'], '/industries/zztest/?units=20' ) && null === $r2['structuredContent']['downloadFormat'], 'new industry: tool runs it; no download claimed' );
$ll2 = calc_llms_filter( $llms );
ok( false !== strpos( $ll2, '/industries/zztest/' ) && false !== strpos( $ll2, 'Supported industries: Telco Retail, Zz Test Retail' ), 'new industry: llms.txt' );
$j2 = json_decode( calc_jsonld( 'zztest' ), true );
ok( 'WebApplication' === $j2['@type'] && false !== strpos( $j2['description'], 'Number of units' ) && false === strpos( implode( ' ', $j2['featureList'] ), 'Downloadable' ), 'new industry: JSON-LD' );
$c2 = calc_page_config( 'zztest' );
ok( 'zztest' === $c2['industry'] && 'units' === $c2['fields'][0]['id'] && ! $c2['download'], 'new industry: page (WebMCP) config' );

/* 3. The WebMCP page script and the wiring are present */
$js = file_get_contents( $snip . '/ph-industry-enhancements/calc-webmcp.js' );
ok( false !== strpos( $js, 'run_business_model_calculator' ) && false !== strpos( $js, 'navigator.modelContext' ) && false !== strpos( $js, 'registerTool' ) && false !== strpos( $js, 'window.PH_CALCULATOR' ), 'calc-webmcp.js registers the tool from the page config' );
ok( false === strpos( $js, 'dataLayer.push({ event: "ph_agent_tool", tool: "run_business_model_calculator", source: "webmcp", page_path: location.pathname, referrer: (document.referrer.split("/")[2] || "none").toLowerCase(), at: new Date().toISOString(), name' ), 'no contact details in analytics' );
$wp = file_get_contents( $snip . '/ph-industry-enhancements/calculators-wp.php' );
ok( false !== strpos( $wp, "'wp_head'" ) && false !== strpos( $wp, "'ph_llms_txt'" ) && false !== strpos( $wp, 'calc-webmcp.js' ), 'WordPress glue: JSON-LD, llms.txt and script' );
ok( false !== strpos( file_get_contents( $snip . '/ph-industry-enhancements/main.php' ), "calculators-wp.php" ), 'main.php loads the glue' );

echo $f ? "$f failed\n" : "calculators: all passed\n"; exit( $f ? 1 : 0 );
