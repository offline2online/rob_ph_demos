<?php
/**
 * What AI agents and AI search read: robots.txt, calculator and tour text in the twins, llms.txt, /llms-full.txt, the MCP server card,
 * the tool contract and the shared JSON-LD nodes. Called from run.php (uses its ok() and the stubs and snippets it has loaded).
 */
$ind_dir = dirname( __DIR__ ) . '/snippets/ph-industry-enhancements';
$ae_dir  = dirname( __DIR__ ) . '/snippets/ph-agent-endpoint';

/* the Industries snippet's data() and the tour constants (tour.php itself needs WordPress, so its constants are lifted from the source) */
$tour_src = (string) file_get_contents( $ind_dir . '/tour.php' );
ok( 1 === preg_match( '/^const TOUR_DEMOS_STD = .*?^\);$/ms', $tour_src, $t1 ) && 1 === preg_match( '/^const TOUR_DEMOS_RM = .*?^\);$/ms', $tour_src, $t2 ) && 1 === preg_match( '/^const TOUR_INDUSTRIES = .*?^\);$/ms', $tour_src, $t3 ), 'found TOUR_INDUSTRIES in tour.php' );
if ( ! function_exists( 'AngieSnippets\PhIndustryEnhancements_10063\data' ) ) {
	eval( 'namespace AngieSnippets\PhIndustryEnhancements_10063; function data( $f ) { return require ' . var_export( $ind_dir . '/', true ) . ' . $f; }' );
}
eval( 'namespace AngieSnippets\PhIndustryEnhancements_10063; ' . $t1[0] . ' ' . $t2[0] . ' ' . $t3[0] );
require_once $ind_dir . '/ai-surface.php';
use function AngieSnippets\PhIndustryEnhancements_10063\{robots_txt_text,ai_calc_section,ai_tour_section,ai_enrich_twin,ai_tours_llms_filter,ai_tours_llms_md,industry_twin,calculators,calc_llms_filter,data as ind_data};
use function AngieSnippets\PhAgentEndpoint___ID__\{llms_full_text,agents_llms_md,server_card,tool_annotations,feature_slug_aliases,faq_for as ai_faq_for};
const AI_IND = 'AngieSnippets\PhIndustryEnhancements_10063\\';
$TOURS = constant( AI_IND . 'TOUR_INDUSTRIES' );

/* ---- robots.txt ---- */
$wp_default = "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n";
foreach ( array( 'WordPress default' => $wp_default, 'live today' => "User-agent: *\nAllow: /\n" ) as $label => $in ) {
	$r = robots_txt_text( $in, true );
	ok( 1 === substr_count( $r, "Sitemap: https://personalisationhub.com/sitemaps.xml" ), "robots.txt ($label): one Sitemap line" );
	ok( false !== strpos( $r, "User-agent: *\n" ) && preg_match( '/^Allow: \/$/m', $r ), "robots.txt ($label): keeps the Allow: / group" );
	foreach ( array( 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bingbot' ) as $a ) {
		ok( 1 === preg_match( '/^User-agent: ' . preg_quote( $a, '/' ) . '$/m', $r ), "robots.txt ($label) names $a" );
	}
	ok( robots_txt_text( $r, true ) === $r, "robots.txt ($label): running the filter twice changes nothing" );
}
$r = robots_txt_text( $wp_default, true );
ok( false !== strpos( $r, "Allow: /wp-admin/admin-ajax.php" ) && 2 === substr_count( $r, 'Disallow: /wp-admin/' ), 'robots.txt: WordPress defaults kept, and the named agents (which ignore the * group) keep the wp-admin Disallow' );
ok( "User-agent: *\nDisallow: /\n" === robots_txt_text( "User-agent: *\nDisallow: /\n", false ), 'robots.txt: left alone when the site discourages search engines' );
ok( ! empty( $GLOBALS['hooks']['robots_txt'] ), 'robots_txt filter registered' );

/* ---- calculator text in the twins comes from calculators() ---- */
$cals = calculators();
$md   = ind_data( 'md.php' );
foreach ( array( 'telco', 'pharmacy' ) as $k ) {
	$twin = industry_twin( $k );
	$sec  = ai_calc_section( $k );
	ok( '' !== $sec && false !== strpos( $twin, $sec ), "$k twin carries the generated calculator section" );
	ok( 1 === substr_count( $twin, '## Benefits calculator' ), "$k twin has one calculator section" );
	foreach ( $cals[ $k ]['fields'] instanceof Closure ? $cals[ $k ]['fields']() : $cals[ $k ]['fields'] as $f ) {
		ok( false !== strpos( $twin, $f['label'] ), "$k twin names the input: " . $f['label'] );
	}
	ok( false !== strpos( $twin, $cals[ $k ]['outcome'] ), "$k twin states the outcome" );
	ok( false !== strpos( $twin, '.xlsx' ) && false !== strpos( $twin, '36 months' ) && false !== strpos( $twin, 'work email' ), "$k twin names the gated 36-month .xlsx workbook" );
	$changed = $cals;
	$changed[ $k ]['outcome'] = 'A different outcome sentence for the test.';
	$changed[ $k ]['fields']  = array( array( 'id' => 'x', 'label' => 'Only input', 'def' => 1, 'min' => 0, 'max' => 9, 'step' => 1 ) );
	$twin2 = ai_enrich_twin( $k, $md[ $k ], $changed );
	ok( false !== strpos( $twin2, 'A different outcome sentence for the test.' ) && false !== strpos( $twin2, 'Only input' ) && $twin2 !== $twin, "$k: changing the calculators() entry changes the twin" );
}
ok( false === strpos( industry_twin( 'telco' ), 'average customer lifetime' ) && false === strpos( industry_twin( 'telco' ), 'visits per store per day' ) && false === strpos( industry_twin( 'telco' ), '24 months' ), 'telco twin no longer describes the old 24-month model' );
foreach ( array_diff( array_keys( $md ), array( 'telco', 'pharmacy' ) ) as $k ) {
	if ( false === strpos( $md[ $k ], '## Benefits calculator' ) ) {
		ok( false === strpos( industry_twin( $k ), '## Benefits calculator' ), "$k has no calculator section and gets none" );
		continue;
	}
	$twin = industry_twin( $k );
	ok( false !== strpos( $twin, preg_match( '/## Benefits calculator\n(.*?)\n\n/s', $md[ $k ], $bm ) ? $bm[1] : '## Benefits calculator' ), "$k (no calculators() entry) keeps its own calculator text" );
}

/* ---- product tours: every TOUR_INDUSTRIES key, nowhere else ---- */
ok( isset( $TOURS['telco'], $TOURS['pharmacy'], $TOURS['retail-media'], $TOURS['convenience'] ), 'TOUR_INDUSTRIES holds telco, pharmacy, retail-media and convenience' );
foreach ( $md as $k => $text ) {
	$twin = industry_twin( $k );
	$tn   = substr_count( $twin, '## Interactive product tour' );
	if ( isset( $TOURS[ $k ] ) ) {
		ok( 1 === $tn, "$k twin has one Interactive product tour section" );
		foreach ( $TOURS[ $k ]['demos'] as $demo ) {
			ok( false !== strpos( $twin, '**' . $demo[0] . ':** ' . $demo[1] ), "$k twin lists the demo " . $demo[0] );
		}
		ok( false !== strpos( $twin, 'https://personalisationhub.com' . $TOURS[ $k ]['page'] ) && false !== strpos( $twin, "own brand" ), "$k twin gives the page URL and says it runs in the visitor's own brand" );
		ok( 3 === count( $TOURS[ $k ]['demos'] ), "$k has three demos" );
		ok( strpos( $twin, '## Interactive product tour' ) < strpos( $twin, '## FAQ' ), "$k tour section comes before the FAQ" );
	} else {
		ok( 0 === $tn, "$k twin has no tour section" );
	}
}
ok( '' === ai_tour_section( 'grocery' ), 'no tour text for an industry without a tour' );

/* ---- llms.txt ---- */
$pages = array();
foreach ( \AngieSnippets\PhAgentEndpoint___ID__\allow_list() as $id => $row ) {
	$pages[ $id ] = array( 'Page ' . $id, 'Summary ' . $id );
}
$llms = calc_llms_filter( ai_tours_llms_filter( ind_data( 'llms.php' ) ) );
$llms = \AngieSnippets\PhAgentEndpoint___ID__\llms_sections( $llms, $pages );
foreach ( array( '## Key facts', '## Platform', '## Interactive product tours', '## Business model calculator', '## For AI agents', '## Pricing and trial' ) as $h ) {
	ok( 1 === substr_count( $llms, $h ), "llms.txt has $h once" );
}
ok( strpos( $llms, '## Interactive product tours' ) < strpos( $llms, '## Pricing and trial' ), 'tours section sits before Pricing and trial' );
preg_match( '/## Platform\n\n(.*?)\n\n## /s', $llms, $pm );
$plines = isset( $pm[1] ) ? array_filter( explode( "\n", $pm[1] ) ) : array();
ok( count( $plines ) >= 10, 'llms.txt Platform has its links' );
foreach ( $plines as $l ) {
	ok( 1 === preg_match( '/^- \[[^\]]+\]\([^)]+\): \S.{15,}/', $l ), 'Platform line has a description: ' . substr( $l, 0, 60 ) );
}
ok( false !== strpos( $llms, '[White Label Retail Media Platform](https://personalisationhub.com/white-label-retail-media-platform/?format=md)' ) && false === strpos( $llms, 'com/retail-media-platform/' ), 'llms.txt names the features page by its new slug and title' );
foreach ( $TOURS as $k => $t ) {
	preg_match( '/## Interactive product tours\n\n(.*?)\n\n## /s', $llms, $tm );
	ok( isset( $tm[1] ) && false !== strpos( $tm[1], '[' . $t['name'] . '](https://personalisationhub.com' . $t['page'] . '?format=md)' ), "llms.txt lists the $k tour" );
	foreach ( $t['demos'] as $demo ) {
		ok( isset( $tm[1] ) && false !== strpos( $tm[1], $demo[0] ), "llms.txt tours name the demo " . $demo[0] );
	}
}
foreach ( array( 'AI-native digital signage', 'in-store personalisation', 'white-label retail media platform', 'queue management', 'appointment booking', 'store sites', 'self-hosted', '30-day free trial on AWS Marketplace', 'Founded: 2018' ) as $term ) {
	ok( false !== stripos( $llms, $term ), "llms.txt says: $term" );
}
ok( ! preg_match( '/Sydney|Australia|Pty Ltd/i', $llms ), 'llms.txt gives no location' );
$agents = agents_llms_md();
$defs   = \AngieSnippets\PhAgentEndpoint___ID__\tool_defs();
ok( 10 === count( $defs ), 'ten tools' );
foreach ( $defs as $d ) {
	ok( 1 === preg_match( '/^  - `' . preg_quote( $d['name'], '/' ) . '`: \S/m', $agents ), 'For AI agents lists ' . $d['name'] . ' on one line' );
}
foreach ( array( '`run_business_model_calculator`', 'GET https://personalisationhub.com/wp-json/ph-agent/v1/tools', '?format=md', '/llms-full.txt', '/.well-known/mcp.json', '(https://personalisationhub.com/mcp)', '(https://personalisationhub.com/help-api/)', 'navigator.modelContext' ) as $needle ) {
	ok( false !== strpos( $llms, $needle ), "For AI agents names $needle" );
}
ok( false === strpos( $llms, 'search the Support Centre from any MCP client' ), 'the old one-line description of the MCP server is gone' );

/* ---- /llms-full.txt ---- */
$GLOBALS['byPath'] = array();
$industry_keys = array_merge( array( 'industries' ), \AngieSnippets\PhAgentEndpoint___ID__\INDUSTRY_SLUGS );
foreach ( $industry_keys as $k ) {
	$GLOBALS['byPath'][ 'industries' === $k ? 'industries' : 'industries/' . $k ] = (object) array( 'ID' => 900 + count( $GLOBALS['byPath'] ), 'post_status' => 'publish', 'post_password' => '', 'post_excerpt' => '' );
}
$GLOBALS['opts']['ph_ae_gen'] = 77;
$GLOBALS['tr']                = array();
$GLOBALS['posts'][7020]->post_status = 'publish';
$full = \AngieSnippets\PhAgentEndpoint___ID__\llms_full_body();
ok( 0 === strpos( $full, "# Personalisation Hub\n" ) && false !== strpos( $full, '## Key facts' ), '/llms-full.txt starts with llms.txt' );
foreach ( $industry_keys as $k ) {
	$twin = \AngieSnippets\PhAgentEndpoint___ID__\industry_md_for( $k );
	$url  = 'industries' === $k ? 'https://personalisationhub.com/industries/' : 'https://personalisationhub.com/industries/' . $k . '/';
	ok( is_string( $twin ) && false !== strpos( $full, "URL: $url\n\n" . trim( $twin ) ), "/llms-full.txt holds the $k twin under its URL" );
}
ok( false !== strpos( $full, "URL: https://personalisationhub.com/digital-signage/\n\n# Digital Signage" ), '/llms-full.txt holds the digital signage twin under its URL' );
ok( false === strpos( $full, "URL: https://personalisationhub.com/store-sites/" ) && false === strpos( $full, 'Lindt' ), '/llms-full.txt leaves out a draft page and demo pages' );
ok( $full === \AngieSnippets\PhAgentEndpoint___ID__\llms_full_body(), '/llms-full.txt is cached with the twins (second call is the transient)' );
ok( "# A\n\n---\n\nURL: u\n\n# B\n" === llms_full_text( "# A\n", array( array( 'u', "# B\n\n" ), array( 'v', '  ' ) ) ), 'llms_full_text skips an empty twin' );

/* ---- /.well-known/mcp.json ---- */
$card = json_decode( json_encode( server_card(), JSON_UNESCAPED_SLASHES ), true );
ok( is_array( $card ) && 'Personalisation Hub' === $card['name'] && strlen( $card['description'] ) > 80, 'server card is JSON with a name and description' );
ok( ! preg_match( '#backlog-tracker|\.web\.app|firebaseapp\.com|cloudfunctions\.net#i', $llms . json_encode( server_card(), JSON_UNESCAPED_SLASHES ) ), 'llms.txt and the server card never name the console host' );
ok( 'https://personalisationhub.com/help-api/' === $card['links']['helpApi'], 'server card: help API on personalisationhub.com' );
ok( 'https://personalisationhub.com/mcp' === $card['endpoint'] && 'https://personalisationhub.com/mcp' === $card['transport']['url'] && 'https://personalisationhub.com/mcp' === $card['remotes'][0]['url'] && 'streamable-http' === $card['transport']['type'] && false === $card['authentication']['required'], 'server card: remote endpoint, streamable HTTP, no auth' );
ok( json_decode( json_encode( $defs ), true ) === $card['tools'], 'server card tools equal the tool contract' );
ok( 'https://personalisationhub.com/llms.txt' === $card['links']['llms'] && 0 === strpos( $card['links']['documentation'], 'https://personalisationhub.com/' ), 'server card links to llms.txt and the docs' );

/* ---- tool contract ---- */
$schema_keys = array();
foreach ( $defs as $d ) {
	ok( isset( $d['title'] ) && strlen( $d['title'] ) >= 8, $d['name'] . ' has a title' );
	ok( strlen( $d['description'] ) >= 80 && preg_match_all( '/[.!?](\s|$)/', $d['description'] ) <= ( 'get_installation_spec' === $d['name'] || 'calculate_business_model' === $d['name'] ? 8 : 3 ), $d['name'] . ' has a description of 80+ characters, 1-3 sentences' );
	ok( $d['annotations'] === array( 'readOnlyHint' => true, 'idempotentHint' => true, 'openWorldHint' => false ) && tool_annotations() === $d['annotations'], $d['name'] . ' has the three annotations' );
	$props = (array) $d['inputSchema']['properties'];
	$schema_keys[ $d['name'] ] = array( array_keys( $props ), $d['inputSchema']['required'] ?? array() );
}
ok( $schema_keys === array(
	'describe_platform' => array( array(), array() ),
	'list_industries' => array( array(), array() ),
	'get_industry' => array( array( 'slug' ), array( 'slug' ) ),
	'get_feature' => array( array( 'slug' ), array( 'slug' ) ),
	'search_help' => array( array( 'query', 'limit' ), array( 'query' ) ),
	'get_help_article' => array( array( 'url' ), array( 'url' ) ),
	'start_free_trial' => array( array(), array() ),
	'book_demo' => array( array(), array() ),
	'get_installation_spec' => array( array(), array() ),
	'calculate_business_model' => array( array( 'industry', 'inputs' ), array() ),
), 'tool names and input properties are unchanged' );
$gf = array_values( array_filter( $defs, function ( $d ) { return 'get_feature' === $d['name']; } ) )[0]['inputSchema']['properties']['slug']['enum'];
ok( in_array( 'white-label-retail-media-platform', $gf, true ) && in_array( 'retail-media-platform', $gf, true ) && count( $gf ) === 9, 'get_feature enum: new slug plus the old one as an alias' );
ok( feature_slug_aliases() === array( 'retail-media-platform' => 'white-label-retail-media-platform' ), 'one alias' );
$pagesLive = array( 3266 => array( 'White Label Retail Media Platform', 'x' ) );
$src2 = array( 'page_md' => function ( $id ) { return 3266 === $id ? "# White Label Retail Media Platform\n" : null; } );
ok( empty( \AngieSnippets\PhAgentEndpoint___ID__\run_tool( 'get_feature', array( 'slug' => 'retail-media-platform' ), $src2 )['isError'] ) && empty( \AngieSnippets\PhAgentEndpoint___ID__\run_tool( 'get_feature', array( 'slug' => 'white-label-retail-media-platform' ), $src2 )['isError'] ), 'get_feature answers for the new slug and the old alias' );
ok( 'white-label-retail-media-platform' === \AngieSnippets\PhAgentEndpoint___ID__\feature_slugs()[3266] && '/white-label-retail-media-platform/' === \AngieSnippets\PhAgentEndpoint___ID__\allow_list()[3266][0], 'the features page is allow-listed at its new URL' );
$gi = array_values( array_filter( $defs, function ( $d ) { return 'get_industry' === $d['name']; } ) )[0];
ok( false !== stripos( $gi['description'], 'calculator' ) && false !== stripos( $gi['description'], 'product tour' ), 'get_industry says it returns the calculator and the tour' );
$dp = array_values( array_filter( $defs, function ( $d ) { return 'describe_platform' === $d['name']; } ) )[0];
foreach ( array( 'AI-native digital signage', 'white-label retail media platform', 'queue', 'store sites', 'self-hosted' ) as $term ) {
	ok( false !== stripos( $dp['description'], $term ), "describe_platform says: $term" );
}

/* ---- JSON-LD ---- */
$sw = \AngieSnippets\PhAgentEndpoint___ID__\software_node();
$og = \AngieSnippets\PhAgentEndpoint___ID__\organization_node();
ok( ! empty( $sw['applicationSubCategory'] ) && count( $sw['featureList'] ) >= 8 && 'CreativeWork' === $sw['softwareHelp']['@type'] && 'https://personalisationhub.com/support-centre/' === $sw['softwareHelp']['url'], 'SoftwareApplication: applicationSubCategory, featureList, softwareHelp' );
ok( 'BusinessAudience' === $sw['audience']['@type'] && false !== stripos( $sw['audience']['audienceType'], 'physical stores' ), 'SoftwareApplication: BusinessAudience of businesses with physical stores' );
ok( count( $og['knowsAbout'] ) >= 6 && in_array( 'AI-native digital signage', $og['knowsAbout'], true ) && in_array( 'White-label retail media platform', $og['knowsAbout'], true ) && 'Worldwide' === $og['areaServed'], 'Organization: knowsAbout and areaServed Worldwide' );
ok( array_keys( $og ) === array( '@type', '@id', 'name', 'legalName', 'url', 'logo', 'description', 'foundingDate', 'founder', 'sameAs', 'knowsAbout', 'areaServed' ), 'Organization property order (the four copies must match byte for byte)' );

/* ---- banned words in everything new ---- */
$new_text = $llms . $full . json_encode( $card ) . json_encode( ai_faq_for( 3266 ) ) . robots_txt_text( $wp_default );
ok( ! preg_match( '/personali[z]/i', $new_text ), 'no US spelling of personalisation' );
ok( ! preg_match( '/\b(lindt|coca-cola|mipharmacy|australian-pork|webdemo|lego)\b/i', $new_text ), 'no client or demo names' );
$mine = $llms . json_encode( $card ) . json_encode( ai_faq_for( 3266 ) ) . ai_tour_section( 'telco' ) . ai_calc_section( 'telco' ) . ai_calc_section( 'pharmacy' ) . ai_tours_llms_md();
ok( ! preg_match( '/\b(dsp|dsps|programmatic|demand[- ]side)\b/i', $mine ), 'no DSP or programmatic text in the new copy' );
ok( ! preg_match( '/\b(price|pricing)\b[^.]*\$\d/i', $llms ), 'no invented pricing' );
