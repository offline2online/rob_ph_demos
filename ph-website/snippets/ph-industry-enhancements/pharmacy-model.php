<?php
/**
 * Pharmacy business model: the one set of assumptions and formulas behind the on-page calculator (enhance.js, pharmCalc),
 * the gated .xlsx download and the agent tools (calculators.php).
 *
 * - pharm_spec()  : inputs, defaults, limits, presets. Same shape as telco_spec().
 * - pharm_calc()  : the formulas. enhance.js (pharmCalc) mirrors them; tests/pharmacy-model.test.* keep the two equal.
 * - pharm_xlsx()  : the downloadable workbook, pre-filled with the visitor's values and live formulas.
 * - REST          : see pharmacy-lead.php.
 *
 * Front-of-house products only: nothing here is earned from products that need pharmacist approval.
 * Workbook helpers (cell, sheet, styles, col) are the telco ones, so both workbooks are built the same way.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_TELCO_MODEL_TEST' ) ) {
	exit;
}

require_once __DIR__ . '/telco-model.php';

/** Presets (not page inputs; editable in the workbook). Equal to PHARM in enhance.js. */
const PHARM_PLAYS  = 4;     // ad plays seen per visit per screen.
const PHARM_FILL   = 0.4;   // share of screen time sold.
const PHARM_BUYERS = 0.3;   // share of visits that buy front of house.
const PHARM_WALK   = 0.03;  // foot-traffic uplift.
const PHARM_DAYS   = 365;   // trading days per year.
const PHARM_MONTHS = 36;

function pharm_spec() {
	return array(
		'plays'  => PHARM_PLAYS,
		'fill'   => PHARM_FILL,
		'buyers' => PHARM_BUYERS,
		'walk'   => PHARM_WALK,
		'days'   => PHARM_DAYS,
		'months' => PHARM_MONTHS,
		'fields' => array(
			array( 'id' => 'stores', 'label' => 'Number of pharmacies', 'def' => 100, 'min' => 1, 'max' => 5000, 'step' => 1 ),
			array( 'id' => 'screens', 'label' => 'Screens per pharmacy', 'def' => 3, 'min' => 1, 'max' => 50, 'step' => 1 ),
			array( 'id' => 'visits', 'label' => 'Daily visits per pharmacy', 'def' => 250, 'min' => 1, 'max' => 5000, 'step' => 10 ),
			array( 'id' => 'basket', 'label' => 'Average front-of-house basket (promotable products only, USD)', 'def' => 22, 'min' => 1, 'max' => 500, 'step' => 1 ),
			array( 'id' => 'cpm', 'label' => 'Media CPM (USD)', 'def' => 25, 'min' => 0, 'max' => 200, 'step' => 1 ),
			array( 'id' => 'uplift', 'label' => 'Front-of-house basket uplift (%)', 'def' => 5, 'min' => 0, 'max' => 50, 'step' => 0.5 ),
		),
	);
}

/** Clamp a submitted value set to the spec; missing or bad values fall back to the default. */
function pharm_clean( $in ) {
	$out = array();
	foreach ( pharm_spec()['fields'] as $f ) {
		$v = is_array( $in ) && isset( $in[ $f['id'] ] ) && is_numeric( $in[ $f['id'] ] ) ? (float) $in[ $f['id'] ] : (float) $f['def'];
		$out[ $f['id'] ] = max( $f['min'], min( $f['max'], $v ) );
	}
	return $out;
}

/**
 * Three streams over three years. Mirrors pharmCalc() in enhance.js. Percentages are whole numbers (5 = 5%).
 * media / basket / traffic / total are the 3-year figures; months are flat (no ramp), so a month is a 36th of that.
 */
function pharm_calc( $v ) {
	$visits  = $v['stores'] * $v['visits'] * PHARM_DAYS;
	$up      = $v['uplift'] / 100;
	$yrs     = PHARM_MONTHS / 12;
	$media   = $visits * $v['screens'] * PHARM_PLAYS * PHARM_FILL * $v['cpm'] / 1000 * $yrs;
	$basket  = $visits * PHARM_BUYERS * $v['basket'] * $up * $yrs;
	$traffic = $visits * PHARM_WALK * PHARM_BUYERS * $v['basket'] * ( 1 + $up ) * $yrs;
	$total   = $media + $basket + $traffic;
	$mo      = array( 's1' => $media / PHARM_MONTHS, 's2' => $basket / PHARM_MONTHS, 's3' => $traffic / PHARM_MONTHS );
	$years   = array();
	$cum     = 0.0;
	for ( $y = 0; $y < 3; $y++ ) {
		$t       = 12 * ( $mo['s1'] + $mo['s2'] + $mo['s3'] );
		$cum    += $t;
		$years[] = array( 's1' => 12 * $mo['s1'], 's2' => 12 * $mo['s2'], 's3' => 12 * $mo['s3'], 'total' => $t, 'cum' => $cum );
	}
	return array(
		'media'        => $media,
		'basket'       => $basket,
		'traffic'      => $traffic,
		'total'        => $total,
		'monthly'      => $mo,
		'years'        => $years,
		'runRate'      => $mo['s1'] + $mo['s2'] + $mo['s3'],
		'visitsYear'   => $visits,
		'impressions'  => $visits * $v['screens'] * PHARM_PLAYS * PHARM_FILL,
	);
}

/** styles: telco's nine plus 9 = input (yellow) in dollars. */
function pharm_styles() {
	return str_replace(
		array( 'cellXfs count="9"', '</cellXfs>' ),
		array( 'cellXfs count="10"', '<xf numFmtId="164" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/></cellXfs>' ),
		telco_styles()
	);
}

/** Build the workbook bytes for a cleaned value set. Returns '' if ZipArchive is missing. */
function pharm_xlsx( $v ) {
	if ( ! class_exists( '\ZipArchive' ) ) {
		return '';
	}
	$c    = pharm_calc( $v );
	$days = PHARM_DAYS / 12;
	$up   = $v['uplift'] / 100;
	$mo   = $c['monthly'];

	/* Assumptions: yellow cells are the visitor's values and the editable presets; the rest follows. */
	$a    = array();
	$a[1] = array( telco_cell( 'A1', 'Assumptions: edit yellow cells only', null, 7 ) );
	$a[3] = array( telco_cell( 'A3', 'Pharmacy estate', null, 1 ) );
	$a[4] = array( telco_cell( 'B4', 'Number of pharmacies' ), telco_cell( 'C4', (float) $v['stores'], null, 2 ), telco_cell( 'D4', 'pharmacies' ) );
	$a[5] = array( telco_cell( 'B5', 'Screens per pharmacy' ), telco_cell( 'C5', (float) $v['screens'], null, 2 ), telco_cell( 'D5', 'screens' ) );
	$a[6] = array( telco_cell( 'B6', 'Daily visits per pharmacy' ), telco_cell( 'C6', (float) $v['visits'], null, 2 ), telco_cell( 'D6', 'visits / pharmacy / day' ) );
	$a[7] = array( telco_cell( 'B7', 'Average front-of-house basket (promotable products only)' ), telco_cell( 'C7', (float) $v['basket'], null, 9 ), telco_cell( 'D7', '$ / basket' ) );
	$a[9] = array( telco_cell( 'A9', 'Stream 1: retail media revenue from front-of-house brands', null, 1 ) );
	$a[10] = array( telco_cell( 'B10', 'Media CPM' ), telco_cell( 'C10', (float) $v['cpm'], null, 9 ), telco_cell( 'D10', '$ per 1,000 impressions (indicative; pharmacy and point-of-care screens typically sell at USD 15-40)' ) );
	$a[11] = array( telco_cell( 'B11', 'Ad plays seen per visit per screen' ), telco_cell( 'C11', (float) PHARM_PLAYS, null, 2 ), telco_cell( 'D11', 'plays' ) );
	$a[12] = array( telco_cell( 'B12', 'Fill rate (share of screen time sold)' ), telco_cell( 'C12', PHARM_FILL, null, 8 ), telco_cell( 'D12', '%' ) );
	$a[14] = array( telco_cell( 'A14', 'Streams 2 and 3: front-of-house basket and foot traffic', null, 1 ) );
	$a[15] = array( telco_cell( 'B15', 'Front-of-house basket uplift (Stream 2)' ), telco_cell( 'C15', $up, null, 8 ), telco_cell( 'D15', '%' ) );
	$a[16] = array( telco_cell( 'B16', 'Share of visits that buy front of house' ), telco_cell( 'C16', PHARM_BUYERS, null, 8 ), telco_cell( 'D16', '%' ) );
	$a[17] = array( telco_cell( 'B17', 'Foot-traffic uplift (Stream 3)' ), telco_cell( 'C17', PHARM_WALK, null, 8 ), telco_cell( 'D17', '%' ) );
	$a[19] = array( telco_cell( 'A19', 'Trading calendar', null, 1 ) );
	$a[20] = array( telco_cell( 'B20', 'Trading days per year' ), telco_cell( 'C20', (float) PHARM_DAYS, null, 2 ), telco_cell( 'D20', 'days / year' ) );
	$a[21] = array( telco_cell( 'B21', 'Trading days per month' ), telco_cell( 'C21', $days, 'C20/12', 0 ), telco_cell( 'D21', 'days / month' ) );
	$a[23] = array( telco_cell( 'A23', 'Derived', null, 1 ) );
	$a[24] = array( telco_cell( 'B24', 'Annual visits, all pharmacies' ), telco_cell( 'C24', $c['visitsYear'], 'C4*C6*C20', 4 ), telco_cell( 'D24', 'visits / year' ) );
	$a[25] = array( telco_cell( 'B25', 'Annual ad impressions sold' ), telco_cell( 'C25', $c['impressions'], 'C24*C5*C11*C12', 4 ), telco_cell( 'D25', 'impressions / year' ) );
	$a[26] = array( telco_cell( 'B26', 'Years modelled' ), telco_cell( 'C26', (float) ( PHARM_MONTHS / 12 ), null, 0 ), telco_cell( 'D26', 'years (36 months)' ) );
	$a[28] = array( telco_cell( 'A28', 'Notes', null, 1 ) );
	$a[29] = array( telco_cell( 'A29', 'All figures are in USD. They are estimates based on the values entered on personalisationhub.com, not a guarantee. Yellow cells are inputs; everything else is calculated.' ) );
	$a[30] = array( telco_cell( 'A30', 'Front-of-house products only. Nothing is earned from products that need pharmacist approval.' ) );
	$a[31] = array( telco_cell( 'A31', 'Targeting uses aggregate or de-identified data only.' ) );
	$a[32] = array( telco_cell( 'A32', 'The CPM is indicative: pharmacy and point-of-care screens typically sell at USD 15-40 CPM.' ) );

	/* Monthly model. Months in columns C..AL (3..38); totals AM..AP (39..42). */
	$m    = array();
	$m[1] = array( telco_cell( 'A1', '3-year monthly model: three revenue streams combined', null, 7 ) );
	$m[3] = array( telco_cell( 'A3', 'Metric', null, 1 ), telco_cell( 'B3', 'Unit', null, 1 ) );
	$m[4] = array();
	for ( $i = 1; $i <= PHARM_MONTHS; $i++ ) {
		$m[4][] = telco_cell( telco_col( $i + 2 ) . '4', $i, null, 1 );
	}
	foreach ( array( 'Year 1 total', 'Year 2 total', 'Year 3 total', '3-year total' ) as $k => $t ) {
		$m[4][] = telco_cell( telco_col( 39 + $k ) . '4', $t, null, 1 );
	}
	$labels = array(
		6  => array( 'STREAM 1: RETAIL MEDIA REVENUE FROM FRONT-OF-HOUSE BRANDS', '' ),
		7  => array( 'Trading days this month', 'days' ),
		8  => array( 'Pharmacies', 'pharmacies' ),
		9  => array( 'Screens per pharmacy', 'screens' ),
		10 => array( 'Daily visits per pharmacy', 'visits/day' ),
		11 => array( 'Ad plays seen per visit per screen', 'plays' ),
		12 => array( 'Fill rate', '%' ),
		13 => array( 'Ad impressions sold', 'impressions' ),
		14 => array( 'Media CPM', '$ / 1,000' ),
		15 => array( 'Stream 1 media revenue', '$' ),
		17 => array( 'STREAM 2: FRONT-OF-HOUSE BASKET UPLIFT', '' ),
		18 => array( 'Visits this month, all pharmacies', 'visits' ),
		19 => array( 'Share of visits buying front of house', '%' ),
		20 => array( 'Average front-of-house basket', '$' ),
		21 => array( 'Basket uplift', '%' ),
		22 => array( 'Stream 2 basket uplift revenue', '$' ),
		24 => array( 'STREAM 3: EXTRA FOOT TRAFFIC', '' ),
		25 => array( 'Visits this month, all pharmacies', 'visits' ),
		26 => array( 'Foot-traffic uplift', '%' ),
		27 => array( 'Extra visits this month', 'visits' ),
		28 => array( 'Share of visits buying front of house', '%' ),
		29 => array( 'Average front-of-house basket', '$' ),
		30 => array( 'Basket value with uplift (1 + uplift)', 'factor' ),
		31 => array( 'Stream 3 foot-traffic revenue', '$' ),
		33 => array( 'COMBINED: STREAMS 1 + 2 + 3', '' ),
		34 => array( 'COMBINED MONTHLY REVENUE: TOTAL', '$' ),
	);
	foreach ( $labels as $r => $l ) {
		$bold    = in_array( $r, array( 6, 17, 24, 33, 34 ), true ) ? 1 : 0;
		$m[ $r ] = array( telco_cell( 'A' . $r, $l[0], null, $bold ), telco_cell( 'B' . $r, $l[1], null, 0 ) );
	}
	$visitsM = $v['stores'] * $v['visits'] * $days;
	$impM    = $visitsM * $v['screens'] * PHARM_PLAYS * PHARM_FILL;
	$extraM  = $visitsM * PHARM_WALK;
	for ( $i = 1; $i <= PHARM_MONTHS; $i++ ) {
		$L   = telco_col( $i + 2 );
		$put = function ( $r, $val, $f, $s ) use ( &$m, $L ) {
			$m[ $r ][] = telco_cell( $L . $r, $val, $f, $s );
		};
		$put( 7, $days, 'Assumptions!$C$21', 0 );
		$put( 8, (float) $v['stores'], 'Assumptions!$C$4', 4 );
		$put( 9, (float) $v['screens'], 'Assumptions!$C$5', 4 );
		$put( 10, (float) $v['visits'], 'Assumptions!$C$6', 4 );
		$put( 11, (float) PHARM_PLAYS, 'Assumptions!$C$11', 0 );
		$put( 12, PHARM_FILL, 'Assumptions!$C$12', 5 );
		$put( 13, $impM, "{$L}8*{$L}9*{$L}10*{$L}7*{$L}11*{$L}12", 4 );
		$put( 14, (float) $v['cpm'], 'Assumptions!$C$10', 3 );
		$put( 15, $mo['s1'], "{$L}13*{$L}14/1000", 3 );
		$put( 18, $visitsM, "{$L}8*{$L}10*{$L}7", 4 );
		$put( 19, PHARM_BUYERS, 'Assumptions!$C$16', 5 );
		$put( 20, (float) $v['basket'], 'Assumptions!$C$7', 3 );
		$put( 21, $up, 'Assumptions!$C$15', 5 );
		$put( 22, $mo['s2'], "{$L}18*{$L}19*{$L}20*{$L}21", 3 );
		$put( 25, $visitsM, "{$L}18", 4 );
		$put( 26, PHARM_WALK, 'Assumptions!$C$17', 5 );
		$put( 27, $extraM, "{$L}25*{$L}26", 4 );
		$put( 28, PHARM_BUYERS, 'Assumptions!$C$16', 5 );
		$put( 29, (float) $v['basket'], 'Assumptions!$C$7', 3 );
		$put( 30, 1 + $up, '1+Assumptions!$C$15', 0 );
		$put( 31, $mo['s3'], "{$L}27*{$L}28*{$L}29*{$L}30", 3 );
		$put( 34, $mo['s1'] + $mo['s2'] + $mo['s3'], "{$L}15+{$L}22+{$L}31", 6 );
	}
	// Totals columns: sums of the months for flows; 3-year = sum of the three years.
	$ranges = array( array( 'C', 'N' ), array( 'O', 'Z' ), array( 'AA', 'AL' ) );
	$flow   = array(
		7  => array( $days, 0 ), 13 => array( $impM, 4 ), 15 => array( $mo['s1'], 3 ), 18 => array( $visitsM, 4 ), 22 => array( $mo['s2'], 3 ),
		25 => array( $visitsM, 4 ), 27 => array( $extraM, 4 ), 31 => array( $mo['s3'], 3 ), 34 => array( $mo['s1'] + $mo['s2'] + $mo['s3'], 6 ),
	);
	foreach ( $flow as $r => $d ) {
		$tot = 0.0;
		for ( $y = 0; $y < 3; $y++ ) {
			$s         = 12 * $d[0];
			$tot      += $s;
			$m[ $r ][] = telco_cell( telco_col( 39 + $y ) . $r, $s, "SUM({$ranges[$y][0]}{$r}:{$ranges[$y][1]}{$r})", $d[1] );
		}
		$m[ $r ][] = telco_cell( 'AP' . $r, $tot, "AM{$r}+AN{$r}+AO{$r}", $d[1] );
	}
	foreach ( $m as $r => $cells ) { // cells must run left to right within a row.
		usort( $m[ $r ], function ( $x, $y ) {
			preg_match( '/r="([A-Z]+)/', $x, $a );
			preg_match( '/r="([A-Z]+)/', $y, $b );
			return strlen( $a[1] ) <=> strlen( $b[1] ) ?: strcmp( $a[1], $b[1] );
		} );
	}

	/* Summary. */
	$M    = "'3-Year Monthly Model'!";
	$s    = array();
	$s[1] = array( telco_cell( 'A1', '3-year summary', null, 7 ) );
	$s[3] = array( telco_cell( 'A3', 'Annual revenue by stream (USD)', null, 1 ) );
	$s[4] = array( telco_cell( 'A4', 'Year', null, 1 ), telco_cell( 'B4', 'Stream 1: retail media revenue ($)', null, 1 ), telco_cell( 'C4', 'Stream 2: basket uplift ($)', null, 1 ), telco_cell( 'D4', 'Stream 3: extra foot traffic ($)', null, 1 ), telco_cell( 'E4', 'Total revenue ($)', null, 1 ), telco_cell( 'F4', 'Cumulative revenue ($)', null, 1 ) );
	$cols = array( 'AM', 'AN', 'AO' );
	for ( $y = 0; $y < 3; $y++ ) {
		$r  = 5 + $y;
		$yr = $c['years'][ $y ];
		$s[ $r ] = array(
			telco_cell( 'A' . $r, 'Year ' . ( $y + 1 ) ),
			telco_cell( 'B' . $r, $yr['s1'], $M . $cols[ $y ] . '15', 3 ),
			telco_cell( 'C' . $r, $yr['s2'], $M . $cols[ $y ] . '22', 3 ),
			telco_cell( 'D' . $r, $yr['s3'], $M . $cols[ $y ] . '31', 3 ),
			telco_cell( 'E' . $r, $yr['total'], $M . $cols[ $y ] . '34', 3 ),
			telco_cell( 'F' . $r, $yr['cum'], 0 === $y ? 'E5' : 'F' . ( $r - 1 ) . '+E' . $r, 3 ),
		);
	}
	$s[8]  = array( telco_cell( 'A8', '3-year total', null, 1 ), telco_cell( 'B8', $c['media'], 'SUM(B5:B7)', 6 ), telco_cell( 'C8', $c['basket'], 'SUM(C5:C7)', 6 ), telco_cell( 'D8', $c['traffic'], 'SUM(D5:D7)', 6 ), telco_cell( 'E8', $c['total'], 'SUM(E5:E7)', 6 ), telco_cell( 'F8', $c['total'], 'F7', 6 ) );
	$s[10] = array( telco_cell( 'A10', 'Key metrics', null, 1 ) );
	$s[11] = array( telco_cell( 'A11', 'Combined monthly revenue run-rate (month 36)' ), telco_cell( 'E11', $c['runRate'], $M . 'AL34', 3 ) );
	$s[12] = array( telco_cell( 'A12', 'Revenue per pharmacy per year (3-year average)' ), telco_cell( 'E12', $c['total'] / 3 / $v['stores'], 'E8/3/Assumptions!C4', 3 ) );
	$s[13] = array( telco_cell( 'A13', 'Media revenue per screen per month' ), telco_cell( 'E13', $mo['s1'] / ( $v['stores'] * $v['screens'] ), $M . 'AL15/(Assumptions!C4*Assumptions!C5)', 3 ) );
	$s[14] = array( telco_cell( 'A14', 'Annual ad impressions sold' ), telco_cell( 'E14', $c['impressions'], 'Assumptions!C25', 4 ) );
	$s[16] = array( telco_cell( 'A16', 'Estimates based on the values entered on personalisationhub.com, in USD. Not a guarantee. Front-of-house products only.' ) );

	/* Sensitivity: 3-year total at three CPMs against three basket uplifts, every cell a live formula. */
	$sn    = array();
	$sn[1] = array( telco_cell( 'A1', 'Sensitivity: 3-year total revenue (USD)', null, 7 ) );
	$sn[3] = array( telco_cell( 'A3', 'Media CPM (down) against front-of-house basket uplift (across). Other inputs as on the Assumptions sheet.' ) );
	$ups   = array( 0.025, 0.05, 0.075 );
	$cpms  = array( 15, 25, 40 );
	$sn[4] = array( telco_cell( 'A4', 'CPM ($) / basket uplift', null, 1 ) );
	foreach ( $ups as $k => $u ) {
		$sn[4][] = telco_cell( telco_col( 2 + $k ) . '4', $u, null, 5 );
	}
	foreach ( $cpms as $j => $cp ) {
		$r        = 5 + $j;
		$sn[ $r ] = array( telco_cell( 'A' . $r, (float) $cp, null, 3 ) );
		foreach ( $ups as $k => $u ) {
			$L   = telco_col( 2 + $k );
			$val = $c['impressions'] * $cp / 1000 * 3
				+ $c['visitsYear'] * PHARM_BUYERS * $v['basket'] * $u * 3
				+ $c['visitsYear'] * PHARM_WALK * PHARM_BUYERS * $v['basket'] * ( 1 + $u ) * 3;
			$f   = "Assumptions!\$C\$25*\$A{$r}/1000*Assumptions!\$C\$26"
				. "+Assumptions!\$C\$24*Assumptions!\$C\$16*Assumptions!\$C\$7*{$L}\$4*Assumptions!\$C\$26"
				. "+Assumptions!\$C\$24*Assumptions!\$C\$17*Assumptions!\$C\$16*Assumptions!\$C\$7*(1+{$L}\$4)*Assumptions!\$C\$26";
			$sn[ $r ][] = telco_cell( $L . $r, $val, $f, 3 );
		}
	}
	$sn[9] = array( telco_cell( 'A9', 'Estimates, not a guarantee. The CPM range reflects typical pharmacy and point-of-care screen pricing (USD 15-40).' ) );

	$wide  = '<cols><col min="1" max="1" width="48" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="42" width="14" customWidth="1"/></cols>';
	$names = array(
		'Pharmacies' => 'C4', 'ScreensPerPharmacy' => 'C5', 'DailyVisitsPerPharmacy' => 'C6', 'FOHBasket' => 'C7', 'MediaCPM' => 'C10', 'PlaysPerVisit' => 'C11',
		'FillRate' => 'C12', 'BasketUplift' => 'C15', 'BuyerShare' => 'C16', 'FootTrafficUplift' => 'C17', 'TradingDaysYear' => 'C20', 'TradingDaysMonth' => 'C21',
	);
	$dn = '';
	foreach ( $names as $n => $ref ) {
		$dn .= '<definedName name="' . $n . '">Assumptions!$' . $ref[0] . '$' . substr( $ref, 1 ) . '</definedName>';
	}
	$sheetsXml = '';
	$overrides = '';
	$rels      = '';
	foreach ( array( 'Assumptions', '3-Year Monthly Model', '3-Year Summary', 'Sensitivity' ) as $k => $nm ) {
		$n          = $k + 1;
		$sheetsXml .= '<sheet name="' . $nm . '" sheetId="' . $n . '" r:id="rId' . $n . '"/>';
		$overrides .= '<Override PartName="/xl/worksheets/sheet' . $n . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
		$rels      .= '<Relationship Id="rId' . $n . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $n . '.xml"/>';
	}
	$files = array(
		'[Content_Types].xml'        => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' . $overrides . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
		'_rels/.rels'                => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
		'xl/workbook.xml'            => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' . $sheetsXml . '</sheets><definedNames>' . $dn . '</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
		'xl/_rels/workbook.xml.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $rels . '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
		'xl/styles.xml'              => pharm_styles(),
		'xl/worksheets/sheet1.xml'   => telco_sheet( $a, $wide ),
		'xl/worksheets/sheet2.xml'   => telco_sheet( $m, $wide ),
		'xl/worksheets/sheet3.xml'   => telco_sheet( $s, $wide ),
		'xl/worksheets/sheet4.xml'   => telco_sheet( $sn, $wide ),
	);
	$tmp = function_exists( 'wp_tempnam' ) ? wp_tempnam( 'pharmacy-model' ) : tempnam( sys_get_temp_dir(), 'pharm' );
	$zip = new \ZipArchive();
	if ( true !== $zip->open( $tmp, \ZipArchive::OVERWRITE ) ) {
		return '';
	}
	foreach ( $files as $name => $body ) {
		$zip->addFromString( $name, $body );
	}
	$zip->close();
	$bytes = (string) file_get_contents( $tmp );
	@unlink( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors,WordPress.WP.AlternativeFunctions
	return $bytes;
}
