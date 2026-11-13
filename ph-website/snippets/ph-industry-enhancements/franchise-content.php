<?php
/**
 * The /be-your-own-boss/ page body (13 Nov 2026), rendered by the [ph_franchise] shortcode inside the site's own header and footer.
 * Copy, section order, colours, type and spacing follow the approved design (Main.dc.html). A sales pitch
 * only: no setup fee, minimum, revenue split or share figure is ever printed (the calculator's share lives in franchise.js and
 * franchise_calc() only). The calculator outputs are rendered with the defaults so the page reads correctly before JS runs.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FRANCHISE_VENUE_TYPES = array( 'Car dealerships', 'Golf clubs', 'Sailing clubs and marinas', 'Fuel and convenience', 'Trade suppliers', 'Rural and farm supplies', 'Independent grocery', 'Liquor stores', 'Hardware', 'Utility shopfronts', 'Gyms and leisure centres', 'Cafés and bakeries' );

/** One "i" info tooltip: a real button, the text in a role=tooltip box it describes. Opens on hover, focus and tap (franchise.js). */
function franchise_tip( $id, $label, $text ) {
	return '<span class="phf-tip"><button type="button" class="phf-tip-b" aria-label="' . esc_attr( $label ) . '" aria-describedby="' . esc_attr( $id ) . '" aria-expanded="false">i</button><span class="phf-tipbox" role="tooltip" id="' . esc_attr( $id ) . '">' . esc_html( $text ) . '</span></span>';
}

function franchise_in_row( $id, $label, $tip, $value, $prefix = '' ) {
	return '<div class="phf-crow"><span class="phf-clab"><label for="' . esc_attr( $id ) . '">' . esc_html( $label ) . '</label>' . franchise_tip( $id . '-tip', 'About ' . strtolower( $label ), $tip ) . '</span>'
		. '<div class="phf-cin">' . ( '' !== $prefix ? '<span class="phf-cpre">' . esc_html( $prefix ) . '</span>' : '' )
		. '<input id="' . esc_attr( $id ) . '" type="number" min="0" step="any" inputmode="decimal" value="' . esc_attr( $value ) . '"></div></div>';
}

function franchise_range_row( $id, $label, $tip, $value, $min, $max ) {
	return '<div class="phf-crow phf-crow-r"><span class="phf-clab"><label for="' . esc_attr( $id ) . '">' . esc_html( $label ) . '</label>' . franchise_tip( $id . '-tip', 'About ' . strtolower( $label ), $tip ) . '</span>'
		. '<input id="' . esc_attr( $id ) . '" type="range" min="' . (int) $min . '" max="' . (int) $max . '" step="1" value="' . esc_attr( $value ) . '">'
		. '<span class="phf-cval" id="' . esc_attr( $id ) . '-v">' . esc_html( $value . '%' ) . '</span></div>';
}

function franchise_out_row( $key, $label, $value ) {
	return '<div class="phf-orow"><span>' . esc_html( $label ) . '</span><span data-out="' . esc_attr( $key ) . '">' . esc_html( $value ) . '</span></div>';
}

function franchise_card( $color, $title, $text, $class = 'phf-card' ) {
	return '<div class="' . esc_attr( $class ) . '" style="border-top-color:' . esc_attr( $color ) . '"><p class="phf-ct">' . esc_html( $title ) . '</p><p>' . esc_html( $text ) . '</p></div>';
}

function franchise_html() {
	$d   = franchise_defaults();
	$out = franchise_view( franchise_calc( $d ) );
	$h   = '<div class="phf" id="phf">';

	/* Hero */
	$h .= '<section id="top" class="phf-sec phf-hero"><div class="phf-wrap phf-hero-in"><div class="phf-hero-copy">'
		. '<h1>Be your own boss</h1>'
		. '<p class="phf-hero-sub">Run your own retail media network</p>'
		. '<p class="phf-hero-p">AI has changed what one person can achieve. If you’re driven, and you use AI tools every day rather than just talk about them, you no longer need a large team to create real value. One focused operator can now do the work of an entire organisation. Use those skills to resell the world-leading white-label retail media platform, with real-time personalisation in store and in other physical venues, to independent businesses nationwide and beyond.</p>'
		. '<div class="phf-ctas"><a class="phf-btn" href="#calculator">See how much you can earn</a><a class="phf-btn phf-btn-o" href="#tour">Request further information</a></div>'
		. '</div><div class="phf-why"><p class="phf-why-h">Why it beats anything out there</p><div class="phf-why-l">';
	foreach ( array(
		array( '#179BC2', 'Personalisation in physical venues', 'Screens adapt in real time to the person in front of them, in any venue, e.g. stores, clubs, dealerships and forecourts.' ),
		array( '#EF61A6', 'Campaigns can be created automatically', 'Brands can bring their own creative, or let AI build, target and launch campaigns for them. Independents can do the same for their own promotions.' ),
		array( '#FE9226', 'Self-optimising, with proof of results', 'Every campaign learns from real in-store sales and improves itself, so advertisers see what they get.' ),
		array( '#60D838', 'Your brand, your own AWS account', 'White-label from end to end, running in your own AWS account. The data and the relationships are yours.' ),
	) as $w ) {
		$h .= '<div class="phf-why-i"><span class="phf-bar" style="background:' . esc_attr( $w[0] ) . '"></span><div><p class="phf-why-t">' . esc_html( $w[1] ) . '</p><p class="phf-why-p">' . esc_html( $w[2] ) . '</p></div></div>';
	}
	$h .= '</div></div></div></section>';

	/* Your head start */
	$h .= '<section class="phf-sec phf-white" aria-labelledby="why"><div class="phf-wrap"><div class="phf-split">'
		. '<h2 id="why">Your head start in a changing industry</h2><div class="phf-split-c">'
		. '<p class="phf-lead">AI is reshaping agencies, ad tech, design and marketing. Roles are changing fast, and many experienced people are choosing to go out on their own.</p>'
		. '<p class="phf-lead">We want to back them. If you have relationships with brands, retailers or businesses with a physical presence, becoming a Personalisation Hub network operator gives you a head start: your own retail media network, ready to sell from day one.</p>'
		. '</div></div></div></section>';

	/* Built for people who know media */
	$h .= '<section class="phf-sec phf-tint" aria-labelledby="who"><div class="phf-wrap">'
		. '<h2 id="who" class="phf-h2s">Built for people who know media</h2>'
		. '<p class="phf-intro">You already have the relationships. Now use them to drive your own advertising revenue, in the real world, where reaching people in person matters more than ever as AI reshapes online media.</p><div class="phf-grid">';
	foreach ( array(
		array( '#EF61A6', 'Agency media and account leads', 'Bring the brands you already buy for into venues no one else is selling.' ),
		array( '#FE9226', 'Ad-tech sales and partnerships', 'Package in-store screens as new inventory for the buyers you know.' ),
		array( '#60D838', 'Retail media specialists', 'You know retail media inside out. Now run your own network, in an industry you know end to end.' ),
	) as $c ) {
		$h .= franchise_card( $c[0], $c[1], $c[2], 'phf-who' );
	}
	$h .= '</div></div></section>';

	/* How it works */
	$h .= '<section id="how" class="phf-sec phf-white" aria-labelledby="how-h"><div class="phf-wrap"><h2 id="how-h" class="phf-h2s phf-h2-40">How it works</h2><ol class="phf-grid phf-steps">';
	foreach ( array(
		array( '1', 'You sign up venues', 'Bring physical venues onto your network, whether they already have screens or you help put them in.' ),
		array( '2', 'You partner with brands and advertisers', 'Sell advertising and experiences across your network, to the brands your venues stock and to local and national advertisers.' ),
		array( '3', 'You run it your own way', 'You choose the commercial model, from revenue share to subscriptions. We give you a proven framework; how you build the business is up to you.' ),
	) as $s ) {
		$h .= '<li><p class="phf-n">' . esc_html( $s[0] ) . '</p><p class="phf-ct">' . esc_html( $s[1] ) . '</p><p>' . esc_html( $s[2] ) . '</p></li>';
	}
	$h .= '</ol></div></section>';

	/* Any business with a physical presence */
	$h .= '<section class="phf-sec phf-dark" aria-labelledby="venues"><div class="phf-wrap"><h2 id="venues" class="phf-h2s">Any business with a physical presence</h2>'
		. '<p class="phf-intro phf-intro-d">If it has a physical location, it can be part of your network, with or without screens today.</p><ul class="phf-chips">';
	foreach ( FRANCHISE_VENUE_TYPES as $v ) {
		$h .= '<li>' . esc_html( $v ) . '</li>';
	}
	$h .= '</ul></div></section>';

	/* Standards */
	$h .= '<section class="phf-sec phf-white" aria-labelledby="standards"><div class="phf-wrap"><div class="phf-split phf-split-m">'
		. '<h2 id="standards">Built to fix retail media&#39;s fragmentation</h2><div class="phf-split-c">'
		. '<p class="phf-lead">Buyers say fragmentation is what holds retail media back. Every network measures, reports and sells differently, so results are hard to compare and campaigns are hard to scale.</p>'
		. '<p class="phf-lead">Your network is built on the standards the industry is converging on, giving brands one consistent, measurable way to buy across every venue you sign.</p>'
		. '</div></div><div class="phf-grid phf-grid-300">';
	foreach ( array(
		array( '#179BC2', 'Standardised measurement', 'Impressions, audiences and outcomes measured in line with the IAB and MRC in-store retail media standards, so results stand up next to every other channel.' ),
		array( '#EF61A6', 'One buy across many venues', 'Hundreds of independent venues become one network, with one buy, one set of formats and one report for brands.' ),
		array( '#FE9226', 'Seamless integrations', 'Connects to the programmatic platforms buyers already use, and to venues\' existing systems through open APIs.' ),
		array( '#60D838', 'Consistent formats and definitions', 'The same screen formats, slot definitions and audience scoring in every venue, so creative runs anywhere without rework.' ),
		array( '#179BC2', 'Closed-loop, incremental results', 'Campaigns measured from screen to sale, showing what was truly incremental, not just what was seen.' ),
		array( '#EF61A6', 'Secure, with no lock-in', 'Runs in your own AWS environment. Shopper data stays private and the network stays yours.' ),
		array( '#FE9226', 'AI-native, with full MCP support', 'Manage your retail media network end to end from the AI tools you already use every day.' ),
	) as $c ) {
		$h .= franchise_card( $c[0], $c[1], $c[2], 'phf-card phf-card-b' );
	}
	$h .= '</div></div></section>';

	/* Benefits calculator */
	$h .= '<section id="calculator" class="phf-sec phf-tint" aria-labelledby="calc"><div class="phf-wrap phf-wrap-calc">'
		. '<p class="phf-eb">Benefits calculator</p><h2 id="calc" class="phf-h2b">What could it be worth to you?</h2>'
		. '<div class="phf-calc"><div class="phf-cin-card"><p class="phf-cin-h">Your network</p><p class="phf-cgrp">Your figures</p>'
		. franchise_in_row( 'c-ven', 'Venues', 'The number of venues on your network, e.g. stores, clubs, dealerships and forecourts.', $d['ven'] )
		. franchise_in_row( 'c-dis', 'Displays per venue', 'The average number of screens showing ads in each venue. Each display a visitor sees counts as an ad view.', $d['dis'] )
		. franchise_in_row( 'c-vis', 'Visitors per venue per day', 'The average number of people who come into each venue on a typical day.', $d['vis'] )
		. franchise_in_row( 'c-cpm', 'Average CPM', 'What advertisers pay for every 1,000 views of their ads.', $d['cpm'], '$' )
		. franchise_in_row( 'c-atv', 'Average transaction value', 'The average amount a visitor spends in the venue. Used to estimate the extra sales venues make when promotions feature endemic brands, i.e. products they sell.', $d['atv'], '$' )
		. '<p class="phf-cgrp phf-cgrp-a">Assumptions</p>'
		. franchise_range_row( 'c-view', 'Visitors who view the ads', 'The share of visitors who see an ad on the screens during their visit.', $d['view'], 5, 100 )
		. franchise_range_row( 'c-up', 'Uplift from personalised offers', 'The extra spend from visitors who see personalised offers for products the venue sells. 15% is a typical uplift from personalisation.', $d['up'], 0, 50 )
		. '</div><div class="phf-cout" aria-live="polite"><p class="phf-cout-l">Your potential income a year</p><p class="phf-cout-v" data-out="yours">' . esc_html( $out['yours'] ) . '</p>'
		. franchise_out_row( 'venues', 'Venues in your network', $out['venues'] )
		. franchise_out_row( 'displays', 'Displays in your network', $out['displays'] )
		. franchise_out_row( 'visitors', 'Visitors a month across your network', $out['visitors'] )
		. franchise_out_row( 'views', 'Ad views a month', $out['views'] )
		. franchise_out_row( 'extraSales', 'Extra sales for your venues a year', $out['extraSales'] )
		. '<div class="phf-how"><span class="phf-tip"><button type="button" class="phf-how-b" aria-describedby="c-how-tip" aria-expanded="false"><span class="phf-how-i" aria-hidden="true">i</span>How it&#39;s calculated</button><span class="phf-tipbox" role="tooltip" id="c-how-tip">Venues × visitors per day × visitors who view the ads × displays per venue gives your monthly ad views. Ad views ÷ 1,000 × CPM gives ad revenue, and your income is your share of it, before costs. Extra venue sales = visitors who view the ads × average transaction value × uplift from personalised offers.</span></span></div>'
		. '<div class="phf-cctas"><a class="phf-pill" href="#tour">Request further information</a><a class="phf-pill phf-pill-o" href="#how">See how it works</a></div>'
		. '</div></div></div></section>';

	/* Independents */
	$h .= '<section class="phf-sec phf-tint" aria-labelledby="independents"><div class="phf-wrap"><div class="phf-split phf-split-m">'
		. '<h2 id="independents">Give independents a fighting chance</h2><div class="phf-split-c">'
		. '<p class="phf-lead">The big chains now run their own retail media networks. Brands pay to be seen in their stores, and that income funds lower prices and protects their margins. Independent businesses miss out, and it\'s getting harder to compete.</p>'
		. '<p class="phf-lead">Your network levels the field, and you have two jobs. Drive advertising revenue across your venues, and keep optimising conversion in every one of them, so independents earn more and sell more without building or running anything themselves.</p>'
		. '</div></div><div class="phf-grid">';
	foreach ( array(
		array( '#179BC2', 'Retail media income', 'New income from advertising in their venue, without having to build or run anything themselves.' ),
		array( '#EF61A6', 'Higher conversion on what they stock', 'Endemic brands promote the products on their shelves, right where customers decide. More of those products sell.' ),
		array( '#FE9226', 'Conversion you keep improving', 'You continually optimise each venue\'s own promotions, personalised to the customers in front of them, so more visitors buy.' ),
		array( '#60D838', 'A way to fight back', 'Extra income and extra sales help them hold their own on price and experience against the big chains.' ),
	) as $c ) {
		$h .= franchise_card( $c[0], $c[1], $c[2] );
	}
	$h .= '</div></div></section>';

	/* Product tour band and the network operator lead */
	$h .= '<section id="tour" class="phf-sec phf-white" aria-labelledby="tour-h"><div class="phf-wrap phf-wrap-tour">'
		. '<p class="phf-eb">Interactive product tour</p><h2 id="tour-h" class="phf-h2b phf-h2-tour">See a retail media network run end to end</h2>'
		. '<p class="phf-tour-p">Watch a venue sell its screens, a brand create a campaign by talking, and one visitor&#39;s journey from arrival to checkout.</p>'
		. '<div class="phf-in" id="phf-in" hidden><p class="phf-in-h" id="phf-in-h" tabindex="-1">You&#39;re in</p><p class="phf-in-p">Three short demos, about two minutes each.</p></div>'
		. '<div class="phf-tbox" id="phf-tbox"><div class="phf-ph" aria-hidden="true"><div class="phf-ph-side"><i class="phf-ph-logo"></i>';
	foreach ( array( 90, 110, 80, 100, 70, 95, 85, 105, 75 ) as $w ) {
		$h .= '<i style="width:' . (int) $w . 'px"></i>';
	}
	$h .= '</div><div class="phf-ph-main"><div class="phf-ph-top"><i style="background:#EF60A7"></i><i style="background:#FE9226"></i><i style="background:#60D838"></i><i style="background:#179BC2"></i></div>'
		. '<div class="phf-ph-grid"><div><i style="width:70%;background:#EF60A7"></i></div><div><i style="width:55%;background:#FE9226"></i></div><div><i style="width:80%;background:#60D838"></i></div><div class="phf-ph-wide"></div></div></div></div>'
		. '<div class="phf-gate" id="phf-gate"><div class="phf-gate-card">'
		. '<p class="phf-gate-h">Unlock the product tour</p>'
		. '<p class="phf-gate-p">Tell us a little about yourself to watch the full walkthrough. Our team will also follow up with more on becoming a network operator.</p>'
		. '<form class="phf-form" id="phf-form" novalidate><div class="phf-fgrid">'
		. '<div class="phf-f"><label for="t-fn">Full name</label><input id="t-fn" name="name" type="text" autocomplete="name" maxlength="120" required></div>'
		. '<div class="phf-f"><label for="t-em">Email</label><input id="t-em" name="email" type="email" autocomplete="email" maxlength="120" required></div>'
		. '<div class="phf-f"><label for="t-li">LinkedIn profile (optional)</label><input id="t-li" name="linkedin" type="url" inputmode="url" autocomplete="url" maxlength="300"></div>'
		. '<div class="phf-f"><label for="t-rg">Where you plan to operate</label><input id="t-rg" name="region" type="text" autocomplete="address-level1" maxlength="120" required></div>'
		. '<div class="phf-f"><label for="t-bg">Your background</label><select id="t-bg" name="background" required><option value="" selected disabled>Select your background</option>';
	foreach ( FRANCHISE_BACKGROUNDS as $b ) {
		$h .= '<option>' . esc_html( $b ) . '</option>';
	}
	$h .= '</select></div></div>'
		. '<input class="phf-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
		. '<label class="phf-cons"><input type="checkbox" name="consent" id="t-cs"><span>I agree to be contacted. See the <a href="/privacy-policy/">privacy policy</a>.</span></label>'
		. '<button type="submit" class="phf-unlock" id="phf-unlock" disabled>Unlock the tour</button>'
		. '<p class="phf-msg" id="phf-msg" role="status" aria-live="polite"></p>'
		. '</form></div></div><div class="phf-mount" id="phf-mount"></div></div></div></section>';

	$h .= '</div>';
	return $h;
}
