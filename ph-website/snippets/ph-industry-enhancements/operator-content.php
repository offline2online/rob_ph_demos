<?php
/**
 * The Run Your Own RMN page's three interactive blocks (an Elementor page from 14 Nov 2026): operator_calculator_html(),
 * operator_tour_html() and operator_faq_html(). operator.php puts each inside its empty Elementor mount container (CSS IDs
 * ph-rmn-calculator, ph-rmn-faq, ph-rmn-tour), server-side; the shortcodes [ph_operator_calculator], [ph_operator_tour] and
 * [ph_operator_faq] render the same blocks. Every other section (hero, "Why it beats anything out there", why, who, how, venues,
 * standards, independents) is built in Elementor from ph-website/elementor/run-your-own-rmn.md; no page copy is rendered here. Styles
 * follow the approved design as updated on 14 Nov 2026 (operator.css). A sales pitch only: no setup fee, minimum, revenue split or
 * share figure is ever printed (the calculator's two shares live in operator.js and operator_calc() only). The calculator outputs are
 * rendered with the defaults, in "Operator or team" mode, so the block reads correctly before JS runs.
 *
 * The lists below are read by the blocks, the FAQPage JSON-LD and the markdown twin. The twin also reads the Elementor page's copy
 * (OPERATOR_H1, OPERATOR_SUBLINE, OPERATOR_HERO_P, operator_why_items(), OPERATOR_HEAD_START, OPERATOR_WAYS_INTRO, operator_ways(),
 * operator_steps(), OPERATOR_VENUES_P, OPERATOR_VENUE_TYPES, OPERATOR_STANDARDS_LEADS, operator_standards(), OPERATOR_INDEP_LEADS,
 * OPERATOR_INDEP_BAND, operator_independents()): those lines are the build brief's word for word (from the project document "Run Your
 * Own RMN page copy (14 Nov, updated design)"), and tests/operator.test.php fails if the brief stops carrying any of them.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const OPERATOR_VENUE_TYPES = array( 'Car dealerships', 'Golf clubs', 'Sailing clubs and marinas', 'Fuel and convenience', 'Trade suppliers', 'Rural and farm supplies', 'Independent grocery', 'Liquor stores', 'Hardware', 'Utility shopfronts', 'Gyms and leisure centres', 'Cafés and bakeries' );
const OPERATOR_H1          = 'Run your own retail media network';
const OPERATOR_SUBLINE     = 'Without the upfront cost';
const OPERATOR_HERO_P      = 'AI has changed what one person can achieve (the rise of the solopreneur). If you’re self-driven and you use AI tools every day rather than just talk about them, you no longer need a large team to deliver real value. One focused operator can now do the work of an entire organisation. Use those skills to launch your own retail media network, in an industry that you know and love. Enable independent businesses nationwide to support real-time personalisation in-store and in other physical venues and help them leverage AI to continually optimise their bottom line.';
const OPERATOR_FAQ_TITLE   = 'Running your own RMN';
const OPERATOR_HOW_CALC    = 'Venues × visitors per day × visitors who view the ads × displays per venue gives your monthly ad views. Ad views ÷ 1,000 × CPM gives ad revenue, and your income is your share of it, before costs. Extra venue sales = visitors who view the ads × average transaction value × uplift from personalised offers. For retailers, those extra sales in your stores are added to your income.';
const OPERATOR_TOUR_H      = 'See a retail media network run end to end';
const OPERATOR_TOUR_P      = 'Watch a venue sell its screens, a brand create a campaign by talking, and one visitor\'s journey from arrival to checkout.';
const OPERATOR_GATE_P      = 'Tell us a little about yourself to watch the full walkthrough. Our team will also follow up with more on the opportunity.';
/** The calculator's "I am" toggle: mode => button label. "operator" is the default. */
const OPERATOR_MODES       = array( 'operator' => 'Operator or team', 'retailer' => 'Retailer' );
/** "Your head start in a changing industry": its two paragraphs. */
const OPERATOR_HEAD_START  = array(
	'AI is reshaping agencies, ad tech, design and marketing. Roles are changing fast, and many experienced people are choosing to go out on their own.',
	'We want to back these people, along with smaller retailers who are being left behind by the big chains. Whether you\'re going solo, building a team or running your own stores, setting up your own retail media network gives you a head start. It\'s your network, under your brand, simply powered by Personalisation Hub. You\'re ready to personalise in-store offers and sell targeted advertising inventory from day one, without the capital outlay of existing solutions.',
);
const OPERATOR_WAYS_INTRO  = 'Pick the path that fits you. Each runs the same white-label platform, under your own brand, in your own AWS account.';
const OPERATOR_VENUES_P    = 'If it has a physical location, it can be part of your network, with or without screens today.';
/** "Built to fix retail media's fragmentation": its two lead paragraphs. */
const OPERATOR_STANDARDS_LEADS = array(
	'Buyers say fragmentation is what holds retail media back. Every network measures, reports and sells differently, so results are hard to compare and campaigns are hard to scale.',
	'Your network is built on the standards the industry is converging on, giving brands one consistent, measurable way to buy across every venue you own or sign up.',
);
/** "Give independents a fighting chance": its two lead paragraphs, then the dark band [title, text]. */
const OPERATOR_INDEP_LEADS = array(
	'The big chains now run their own retail media networks. Brands pay to be seen in their stores, and that income funds lower prices and protects their margins. Independent businesses and smaller retailers miss out, and existing solutions cost more than most can justify.',
	'Running your own retail media network levels the field, and it has two jobs. Drive advertising revenue across every venue or store, and keep optimising conversion in each one, so independents and smaller retailers earn more and sell more without the upfront cost.',
);
const OPERATOR_INDEP_BAND  = array(
	'Independents don\'t have the time to run their screens. You do.',
	'Most independent owners and smaller groups simply don\'t have the people or the hours to manage what plays on their screens, let alone optimise it. That\'s the gap you fill. You manage their screens for them, keep optimising in-store conversion, and sell advertising, ideally from the endemic brands they already stock. With someone motivated to grow their sales running it all, installing screens becomes an easy yes.',
);

/** "Why it beats anything out there": [colour, title, text]. */
function operator_why_items() {
	return array(
		array( '#179BC2', 'Personalisation in physical venues', 'Screens adapt in real time to any context, such as location, local venue conditions, time and weather, as well as to the person in front of them, in any venue, e.g. stores, clubs, dealerships and forecourts.' ),
		array( '#EF61A6', 'Campaigns can be created automatically', 'Brands can bring their own creative, or let AI build, target and launch campaigns for them. Independents can do the same for their own promotions.' ),
		array( '#FE9226', 'Self-optimising, with proof of results', 'Every campaign learns from real in-store sales and keeps improving in line with retail media best practice, so advertisers see what they get.' ),
		array( '#60D838', 'Your brand, your own AWS account', 'White-label from end to end, running in your own AWS account. The data and the relationships are yours.' ),
	);
}

/** "Three ways to run your own network": [colour, title, text]. */
function operator_ways() {
	return array(
		array( '#EF61A6', 'Individual operator', 'Build your own income by running a network across many venues of one kind, such as a portfolio of golf clubs. With AI, one driven person can do the work of a whole department.' ),
		array( '#FE9226', 'Operator team', 'Team up a retail media expert, an ad sales expert and a creative agency expert. Between you, you cover venues, advertisers and campaigns, all focused on maximising the advertising revenue your venues earn and the in-store sales they make from the endemic brands they stock.' ),
		array( '#60D838', 'Small to medium retailer', 'Run your own omnichannel retail media network, on your own domain, seamlessly connecting experiences across your website, app and stores. Serve hyper-personalised, targeted offers without the upfront investment, all running securely in your own virtual private cloud.' ),
	);
}

/** "How it works": [number, title, text]. */
function operator_steps() {
	return array(
		array( '1', 'Get set up', 'We onboard you onto the white-label platform in your own AWS account, with the playbooks, templates and sales framework you need to launch.' ),
		array( '2', 'Roll out with a free runway', 'Sign up venues or switch on your stores, and win your first advertisers, with time to get up and running before you pay for the platform.' ),
		array( '3', 'Grow on outcomes', 'Once you\'re live, our model is based on outcomes, so we only grow when you do. Operators choose their own commercial model with venues.' ),
	);
}

/** "Built to fix retail media's fragmentation": the eight cards, [colour, title, text]. */
function operator_standards() {
	return array(
		array( '#179BC2', 'Standardised measurement', 'Impressions, audiences and outcomes measured in line with the IAB and MRC in-store retail media standards, so results stand up next to every other channel.' ),
		array( '#EF61A6', 'One buy across many venues', 'Hundreds of independent venues become one network, with one buy, one set of formats and one report for brands.' ),
		array( '#FE9226', 'Seamless integrations', 'Connects to the programmatic platforms buyers already use, and to venues\' existing systems through open APIs.' ),
		array( '#60D838', 'Consistent formats and definitions', 'The same screen formats, slot definitions and audience scoring in every venue, so creative runs anywhere without rework.' ),
		array( '#179BC2', 'Closed-loop, incremental results', 'Campaigns measured from screen to sale, showing what was truly incremental, not just what was seen.' ),
		array( '#EF61A6', 'Your brand, your data, your network', 'Runs under your brand in your own AWS environment. You use your own shopper and venue data, it stays private, and the network and its relationships are yours.' ),
		array( '#FE9226', 'AI-native, with full MCP support', 'Manage your retail media network end to end from the AI tools you already use every day. Every campaign and transaction builds up historic context that keeps optimising campaign and sales performance, so each venue\'s network becomes more valuable, and harder to walk away from, the longer it runs.' ),
		array( '#60D838', 'A dedicated engineering team behind you', 'Our engineers work solely on optimising the end-to-end solution, so your network keeps pace as retail media, real-time personalisation and agentic personalisation evolve, including the custom AI models and agents we are refining to add value for retailers.' ),
	);
}

/** "Give independents a fighting chance": the four cards, [colour, title, text]. */
function operator_independents() {
	return array(
		array( '#179BC2', 'Retail media income', 'New income from advertising in their venue, without having to build or run anything themselves.' ),
		array( '#EF61A6', 'Higher conversion on what they stock', 'Endemic brands promote the products on their shelves, right where customers decide. More of those products sell.' ),
		array( '#FE9226', 'Conversion you keep improving', 'You continually optimise each venue\'s own promotions, personalised to the customers in front of them, so more visitors buy.' ),
		array( '#60D838', 'A way to fight back', 'Extra income and extra sales help them hold their own on price and experience against the big chains.' ),
	);
}

/**
 * The calculator's inputs, in page order: key => [element id, label, tooltip, prefix] for the number inputs, [.., min, max] for the
 * two sliders (type 'range'). Read by the page, the twin and (through the element ids) the estimate_rmn_earnings WebMCP tool.
 */
function operator_calc_fields() {
	return array(
		'ven'  => array( 'type' => 'number', 'id' => 'c-ven', 'label' => 'Venues', 'tip' => 'The number of venues on your network, e.g. stores, clubs, dealerships and forecourts.', 'prefix' => '' ),
		'dis'  => array( 'type' => 'number', 'id' => 'c-dis', 'label' => 'Displays per venue', 'tip' => 'The average number of screens showing ads in each venue. Each display a visitor sees counts as an ad view.', 'prefix' => '' ),
		'vis'  => array( 'type' => 'number', 'id' => 'c-vis', 'label' => 'Visitors per venue per day', 'tip' => 'The average number of people who come into each venue on a typical day.', 'prefix' => '' ),
		'cpm'  => array( 'type' => 'number', 'id' => 'c-cpm', 'label' => 'Average CPM', 'tip' => 'What advertisers pay for every 1,000 views of their ads.', 'prefix' => '$' ),
		'atv'  => array( 'type' => 'number', 'id' => 'c-atv', 'label' => 'Average transaction value', 'tip' => 'The average amount a visitor spends in the venue. Used to estimate the extra sales venues make when promotions feature endemic brands, i.e. products they sell.', 'prefix' => '$' ),
		'view' => array( 'type' => 'range', 'id' => 'c-view', 'label' => 'Visitors who view the ads', 'tip' => 'The share of visitors who see an ad on the screens during their visit.', 'min' => 5, 'max' => 100 ),
		'up'   => array( 'type' => 'range', 'id' => 'c-up', 'label' => 'Uplift from personalised offers', 'tip' => 'The extra spend from visitors who see personalised offers for products the venue sells. 15% is a typical uplift from personalisation.', 'min' => 0, 'max' => 50 ),
	);
}

/**
 * The calculator's outputs, in page order: data-out key => label, for the toggle's mode. "Retailer" renames the venues and extra
 * sales rows (and adds those extra sales to the income: operator_calc()).
 */
function operator_calc_outputs( $mode = 'operator' ) {
	$retailer = 'retailer' === $mode;
	return array(
		'yours'      => 'Your potential income a year',
		'venues'     => $retailer ? 'Stores in your network' : 'Venues in your network',
		'displays'   => 'Displays in your network',
		'visitors'   => 'Visitors a month across your network',
		'views'      => 'Ad views a month',
		'extraSales' => $retailer ? 'Extra sales in your stores a year' : 'Extra sales for your venues a year',
	);
}

/**
 * "Running your own RMN": [question, answer]. Plain text. Every answer restates something already on the page: the three ways to run a
 * network, "without the upfront cost", the free runway, growing on outcomes and the calculator's Retailer mode (no new figures, no
 * client or brand names, no income share figure, no country positioning). The visible accordion, the FAQPage JSON-LD and the twin's
 * FAQ all print this list, so they always match.
 */
function operator_faq() {
	return array(
		array( 'What is a retail media network?', 'A retail media network sells advertising on the screens in physical venues, such as stores, clubs, dealerships and forecourts, to brands and advertisers. When you run your own, the network is yours, under your brand: screens adapt in real time to any context, such as location, time and weather, as well as to the person in front of them. Any business with a physical presence can be part of it, with or without screens today.' ),
		array( 'Who is running your own RMN for?', 'There are three ways to run your own network. An individual operator builds their own income by running a network across many venues of one kind, such as a portfolio of golf clubs. An operator team brings together a retail media expert, an ad sales expert and a creative agency expert, who cover venues, advertisers and campaigns between them. A small to medium retailer runs their own omnichannel retail media network, on their own domain, across their website, app and stores. Each runs the same white-label platform.' ),
		array( 'What does it cost to get started?', 'You can run your own retail media network without the upfront cost. We onboard you onto the white-label platform in your own AWS account, with the playbooks, templates and sales framework you need to launch. You then roll out with a free runway: time to sign up venues or switch on your stores, and win your first advertisers, before you pay for the platform. Once you\'re live, our model is based on outcomes, so we only grow when you do.' ),
		array( 'Where does my retail media network run?', 'On a white-label platform, under your own brand and in your own AWS account. You use your own shopper and venue data, it stays private, and the network and its relationships are yours.' ),
		array( 'How does the earnings estimate work?', 'The benefits calculator on this page multiplies your venues, visitors per venue per day, the visitors who view the ads and the displays per venue to give your monthly ad views. Ad views ÷ 1,000 × the average CPM gives ad revenue, and your potential income is your share of it, before costs. It also estimates the extra sales from personalised offers. Choose "Operator or team" to see the extra sales for your venues, or "Retailer" to see the extra sales in your stores, which are then added to your income. Change any figure to see your own estimate.' ),
		array( 'How do I get started?', 'Take the interactive product tour on this page: tell us a little about yourself to unlock it and request further information. Our team will also follow up with more on the opportunity.' ),
	);
}

function operator_tip( $id, $label, $text ) {
	return '<span class="phf-tip"><button type="button" class="phf-tip-b" aria-label="' . esc_attr( $label ) . '" aria-describedby="' . esc_attr( $id ) . '" aria-expanded="false">i</button><span class="phf-tipbox" role="tooltip" id="' . esc_attr( $id ) . '">' . esc_html( $text ) . '</span></span>';
}

function operator_in_row( $id, $label, $tip, $value, $prefix = '' ) {
	return '<div class="phf-crow"><span class="phf-clab"><label for="' . esc_attr( $id ) . '">' . esc_html( $label ) . '</label>' . operator_tip( $id . '-tip', 'About ' . strtolower( $label ), $tip ) . '</span>'
		. '<div class="phf-cin">' . ( '' !== $prefix ? '<span class="phf-cpre">' . esc_html( $prefix ) . '</span>' : '' )
		. '<input id="' . esc_attr( $id ) . '" type="number" min="0" step="any" inputmode="decimal" value="' . esc_attr( $value ) . '"></div></div>';
}

function operator_range_row( $id, $label, $tip, $value, $min, $max ) {
	return '<div class="phf-crow phf-crow-r"><span class="phf-clab"><label for="' . esc_attr( $id ) . '">' . esc_html( $label ) . '</label>' . operator_tip( $id . '-tip', 'About ' . strtolower( $label ), $tip ) . '</span>'
		. '<input id="' . esc_attr( $id ) . '" type="range" min="' . (int) $min . '" max="' . (int) $max . '" step="1" value="' . esc_attr( $value ) . '">'
		. '<span class="phf-cval" id="' . esc_attr( $id ) . '-v">' . esc_html( $value . '%' ) . '</span></div>';
}

function operator_out_row( $key, $label, $value ) {
	return '<div class="phf-orow"><span data-lab="' . esc_attr( $key ) . '">' . esc_html( $label ) . '</span><span data-out="' . esc_attr( $key ) . '">' . esc_html( $value ) . '</span></div>';
}

/** The number inputs ('number') or the two sliders ('range'), in page order, at the values in $d. */
function operator_calc_rows( array $d, $type ) {
	$h = '';
	foreach ( operator_calc_fields() as $k => $f ) {
		if ( $type !== $f['type'] ) {
			continue;
		}
		$h .= 'range' === $type
			? operator_range_row( $f['id'], $f['label'], $f['tip'], $d[ $k ], $f['min'], $f['max'] )
			: operator_in_row( $f['id'], $f['label'], $f['tip'], $d[ $k ], $f['prefix'] );
	}
	return $h;
}

/** The output rows under the headline figure (every output but "yours"). */
function operator_out_rows( array $out ) {
	$h = '';
	foreach ( operator_calc_outputs() as $k => $label ) {
		if ( 'yours' !== $k ) {
			$h .= operator_out_row( $k, $label, $out[ $k ] );
		}
	}
	return $h;
}

/** The FAQPage JSON-LD for the visible FAQ: the same operator_faq() rows, word for word, part of the page's WebPage. */
function operator_faq_ld() {
	$q = array();
	foreach ( operator_faq() as $qa ) {
		$q[] = array( '@type' => 'Question', 'name' => $qa[0], 'acceptedAnswer' => array( '@type' => 'Answer', 'text' => $qa[1] ) );
	}
	return array( '@context' => 'https://schema.org', '@type' => 'FAQPage', '@id' => OPERATOR_URL . '#faq', 'url' => OPERATOR_URL, 'inLanguage' => 'en-GB', 'isPartOf' => array( '@id' => OPERATOR_URL . '#webpage' ), 'mainEntity' => $q );
}

/** A block's wrapper: .phf scopes operator.css and marks the block for operator.js. */
function operator_block( $name, $inner ) {
	return '<div class="phf phf-block" data-phf="' . esc_attr( $name ) . '">' . $inner . '</div>';
}

/**
 * The FAQ block: "Running your own RMN", one native <details> per operator_faq() row (keyboard, tap and no-JS all work), followed by
 * its FAQPage JSON-LD built from the same rows, so the accordion and the structured data can never drift apart.
 */
function operator_faq_html() {
	$h = '<section id="faq" class="phf-sec phf-white" aria-labelledby="faq-h"><div class="phf-wrap phf-wrap-faq">'
		. '<h2 id="faq-h" class="phf-h2s">' . esc_html( OPERATOR_FAQ_TITLE ) . '</h2><div class="phf-faq">';
	foreach ( operator_faq() as $i => $qa ) {
		$h .= '<details class="phf-faq-i" id="faq-' . ( $i + 1 ) . '"><summary class="phf-faq-q"><span>' . esc_html( $qa[0] ) . '</span><span class="phf-faq-x" aria-hidden="true"></span></summary>'
			. '<div class="phf-faq-a"><p>' . esc_html( $qa[1] ) . '</p></div></details>';
	}
	$h .= '</div></div></section><script type="application/ld+json">' . operator_json_ld( operator_faq_ld() ) . '</script>';
	return operator_block( 'faq', $h );
}

/**
 * The calculator's "I am" toggle, under "Your network": a group of two buttons, "Operator or team" (pressed by default) and "Retailer".
 * operator.js switches the mode on click (so on tap, Enter and Space too) and keeps aria-pressed in step.
 */
function operator_mode_toggle() {
	$h = '<div class="phf-aud" role="group" aria-label="I am">';
	foreach ( OPERATOR_MODES as $mode => $label ) {
		$h .= '<button type="button" class="phf-aud-b" data-aud="' . esc_attr( $mode ) . '" aria-pressed="' . ( 'operator' === $mode ? 'true' : 'false' ) . '">' . esc_html( $label ) . '</button>';
	}
	return $h . '</div>';
}

/**
 * The calculator block: "What could it be worth to you?", the "I am" toggle, inputs and tooltips, the result panel at the defaults
 * (Operator or team), its two CTAs.
 */
function operator_calculator_html() {
	$d   = operator_defaults();
	$out = operator_view( operator_calc( $d ) );
	$h   = '<section id="calculator" class="phf-sec phf-tint" aria-labelledby="calc"><div class="phf-wrap phf-wrap-calc">'
		. '<p class="phf-eb">Benefits calculator</p><h2 id="calc" class="phf-h2b">What could it be worth to you?</h2>'
		. '<div class="phf-calc"><div class="phf-cin-card"><p class="phf-cin-h">Your network</p>' . operator_mode_toggle() . '<p class="phf-cgrp">Your figures</p>'
		. operator_calc_rows( $d, 'number' )
		. '<p class="phf-cgrp phf-cgrp-a">Assumptions</p>'
		. operator_calc_rows( $d, 'range' )
		. '</div><div class="phf-cout" aria-live="polite"><p class="phf-cout-l">' . esc_html( operator_calc_outputs()['yours'] ) . '</p><p class="phf-cout-v" data-out="yours">' . esc_html( $out['yours'] ) . '</p>'
		. operator_out_rows( $out )
		. '<div class="phf-how"><span class="phf-tip"><button type="button" class="phf-how-b" aria-describedby="c-how-tip" aria-expanded="false"><span class="phf-how-i" aria-hidden="true">i</span>How it&#39;s calculated</button><span class="phf-tipbox" role="tooltip" id="c-how-tip">' . esc_html( OPERATOR_HOW_CALC ) . '</span></span></div>'
		. '<div class="phf-cctas"><a class="phf-pill" href="#tour">Request further information</a><a class="phf-pill phf-pill-o" href="#how">See how it works</a></div>'
		. '</div></div></div></section>';
	return operator_block( 'calculator', $h );
}

/** The tour block: the product tour band, the network operator gate (posts ph-site/v1/operator-lead) and the tour's mount point. */
function operator_tour_html() {
	$h = '<section id="tour" class="phf-sec phf-white" aria-labelledby="tour-h"><div class="phf-wrap phf-wrap-tour">'
		. '<p class="phf-eb">Interactive product tour</p><h2 id="tour-h" class="phf-h2b phf-h2-tour">' . esc_html( OPERATOR_TOUR_H ) . '</h2>'
		. '<p class="phf-tour-p">' . esc_html( OPERATOR_TOUR_P ) . '</p>'
		. '<div class="phf-in" id="phf-in" hidden><p class="phf-in-h" id="phf-in-h" tabindex="-1">You&#39;re in</p><p class="phf-in-p">Three short demos, about two minutes each.</p></div>'
		. '<div class="phf-tbox" id="phf-tbox"><div class="phf-ph" aria-hidden="true"><div class="phf-ph-side"><i class="phf-ph-logo"></i>';
	foreach ( array( 90, 110, 80, 100, 70, 95, 85, 105, 75 ) as $w ) {
		$h .= '<i style="width:' . (int) $w . 'px"></i>';
	}
	$h .= '</div><div class="phf-ph-main"><div class="phf-ph-top"><i style="background:#EF60A7"></i><i style="background:#FE9226"></i><i style="background:#60D838"></i><i style="background:#179BC2"></i></div>'
		. '<div class="phf-ph-grid"><div><i style="width:70%;background:#EF60A7"></i></div><div><i style="width:55%;background:#FE9226"></i></div><div><i style="width:80%;background:#60D838"></i></div><div class="phf-ph-wide"></div></div></div></div>'
		. '<div class="phf-gate" id="phf-gate"><div class="phf-gate-card">'
		. '<p class="phf-gate-h">Unlock the product tour</p>'
		. '<p class="phf-gate-p">' . esc_html( OPERATOR_GATE_P ) . '</p>'
		. '<form class="phf-form" id="phf-form" novalidate><div class="phf-fgrid">'
		. '<div class="phf-f"><label for="t-fn">Full name</label><input id="t-fn" name="name" type="text" autocomplete="name" maxlength="120" required></div>'
		. '<div class="phf-f"><label for="t-em">Email</label><input id="t-em" name="email" type="email" autocomplete="email" maxlength="120" required></div>'
		. '<div class="phf-f"><label for="t-li">LinkedIn profile (optional)</label><input id="t-li" name="linkedin" type="url" inputmode="url" autocomplete="url" maxlength="300"></div>'
		. '<div class="phf-f"><label for="t-rg">Where you plan to operate</label><input id="t-rg" name="region" type="text" autocomplete="address-level1" maxlength="120" required></div>'
		. '<div class="phf-f"><label for="t-ia">I am</label><select id="t-ia" name="audience" required><option value="" selected disabled>Select one</option>';
	foreach ( OPERATOR_AUDIENCES as $a ) {
		$h .= '<option>' . esc_html( $a ) . '</option>';
	}
	$h .= '</select></div>'
		. '<div class="phf-f"><label for="t-bg">Your background</label><select id="t-bg" name="background" required><option value="" selected disabled>Select your background</option>';
	foreach ( OPERATOR_BACKGROUNDS as $b ) {
		$h .= '<option>' . esc_html( $b ) . '</option>';
	}
	$h .= '</select></div></div>'
		. '<input class="phf-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
		. '<label class="phf-cons"><input type="checkbox" name="consent" id="t-cs"><span>I agree to be contacted. See the <a href="/privacy-policy/">privacy policy</a>.</span></label>'
		. '<button type="submit" class="phf-unlock" id="phf-unlock" disabled>Unlock the tour</button>'
		. '<p class="phf-msg" id="phf-msg" role="status" aria-live="polite"></p>'
		. '</form></div></div><div class="phf-mount" id="phf-mount"></div></div></div></section>';
	return operator_block( 'tour', $h );
}
