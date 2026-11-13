<?php
/**
 * Pubs & Hospitality business model: the one set of assumptions and formulas behind the on-page calculator (enhance.js,
 * pubsCalc), the gated .xlsx download and the agent tools (calculators.php).
 *
 * - pubs_spec()  : inputs, defaults, limits, presets. Same shape as pharm_spec().
 * - pubs_calc()  : the formula. enhance.js (pubsCalc) mirrors it; tests/pubs-model.test.* keep the two equal.
 * - pubs_xlsx()  : the downloadable workbook, pre-filled with the visitor's values and live formulas.
 * - REST         : see pubs-lead.php.
 *
 * Annual uplift = venues × guests per venue per day × trading days × share of guests reached × average revenue per head × uplift.
 * Led by average revenue per head (food, drink and everything else a guest spends), not drinks alone.
 * Workbook helpers (cell, sheet, col) are the telco ones and the styles are the pharmacy ones, so every workbook is built the same way.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_TELCO_MODEL_TEST' ) ) {
	exit;
}

require_once __DIR__ . '/telco-model.php';
require_once __DIR__ . '/pharmacy-model.php';

/** Presets (not page inputs; editable in the workbook). Equal to PUBS in enhance.js. */
const PUBS_DAYS   = 365; // trading days per year.
const PUBS_MONTHS = 36;

function pubs_spec() {
	return array(
		'days'   => PUBS_DAYS,
		'months' => PUBS_MONTHS,
		'fields' => array(
			array( 'id' => 'venues', 'label' => 'Venues', 'def' => 50, 'min' => 1, 'max' => 5000, 'step' => 1 ),
			array( 'id' => 'guests', 'label' => 'Guests per venue per day', 'def' => 200, 'min' => 1, 'max' => 5000, 'step' => 10 ),
			array( 'id' => 'revenue', 'label' => 'Average revenue per head (USD)', 'def' => 45, 'min' => 1, 'max' => 500, 'step' => 0.5 ),
			array( 'id' => 'reach', 'label' => 'Share of guests reached by personalised offers (%)', 'def' => 60, 'min' => 0, 'max' => 100, 'step' => 1 ),
			array( 'id' => 'uplift', 'label' => 'Uplift in revenue per head from personalised offers (%)', 'def' => 5, 'min' => 0, 'max' => 50, 'step' => 0.5 ),
		),
	);
}

/** Clamp a submitted value set to the spec; missing or bad values fall back to the default. */
function pubs_clean( $in ) {
	$out = array();
	foreach ( pubs_spec()['fields'] as $f ) {
		$v = is_array( $in ) && isset( $in[ $f['id'] ] ) && is_numeric( $in[ $f['id'] ] ) ? (float) $in[ $f['id'] ] : (float) $f['def'];
		$out[ $f['id'] ] = max( $f['min'], min( $f['max'], $v ) );
	}
	return $out;
}

/**
 * One stream over three years. Mirrors pubsCalc() in enhance.js. Percentages are whole numbers (5 = 5%).
 * Months are flat (no ramp), so a month is a twelfth of the annual figure and the 3-year total is three years of it.
 */
function pubs_calc( $v ) {
	$guests  = $v['venues'] * $v['guests'] * PUBS_DAYS;
	$reached = $guests * $v['reach'] / 100;
	$annual  = $reached * $v['revenue'] * $v['uplift'] / 100;
	$yrs     = PUBS_MONTHS / 12;
	$total   = $annual * $yrs;
	$month   = $annual / 12;
	$years   = array();
	$cum     = 0.0;
	for ( $y = 0; $y < 3; $y++ ) {
		$t       = 12 * $month;
		$cum    += $t;
		$years[] = array( 'total' => $t, 'cum' => $cum, 'reached' => $reached );
	}
	return array(
		'annual'      => $annual,
		'total'       => $total,
		'monthly'     => $month,
		'years'       => $years,
		'runRate'     => $month,
		'guestsYear'  => $guests,
		'reachedYear' => $reached,
		'perVenue'    => $annual / $v['venues'],
		'perGuest'    => $v['revenue'] * $v['uplift'] / 100,
	);
}

/** Build the workbook bytes for a cleaned value set. Returns '' if ZipArchive is missing. */
function pubs_xlsx( $v ) {
	if ( ! class_exists( '\ZipArchive' ) ) {
		return '';
	}
	$c     = pubs_calc( $v );
	$days  = PUBS_DAYS / 12;
	$reach = $v['reach'] / 100;
	$up    = $v['uplift'] / 100;
	$mo    = $c['monthly'];

	/* Assumptions: yellow cells are the visitor's values and the editable preset; the rest follows. */
	$a     = array();
	$a[1]  = array( telco_cell( 'A1', 'Assumptions: edit yellow cells only', null, 7 ) );
	$a[3]  = array( telco_cell( 'A3', 'Venue estate', null, 1 ) );
	$a[4]  = array( telco_cell( 'B4', 'Venues' ), telco_cell( 'C4', (float) $v['venues'], null, 2 ), telco_cell( 'D4', 'venues' ) );
	$a[5]  = array( telco_cell( 'B5', 'Guests per venue per day' ), telco_cell( 'C5', (float) $v['guests'], null, 2 ), telco_cell( 'D5', 'guests / venue / day' ) );
	$a[6]  = array( telco_cell( 'B6', 'Average revenue per head' ), telco_cell( 'C6', (float) $v['revenue'], null, 9 ), telco_cell( 'D6', '$ / guest (everything a guest spends)' ) );
	$a[8]  = array( telco_cell( 'A8', 'Personalised offers', null, 1 ) );
	$a[9]  = array( telco_cell( 'B9', 'Share of guests reached by personalised offers' ), telco_cell( 'C9', $reach, null, 8 ), telco_cell( 'D9', '% of guests' ) );
	$a[10] = array( telco_cell( 'B10', 'Uplift in revenue per head from personalised offers' ), telco_cell( 'C10', $up, null, 8 ), telco_cell( 'D10', '% of revenue per head, guests reached only' ) );
	$a[12] = array( telco_cell( 'A12', 'Trading calendar', null, 1 ) );
	$a[13] = array( telco_cell( 'B13', 'Trading days per year' ), telco_cell( 'C13', (float) PUBS_DAYS, null, 2 ), telco_cell( 'D13', 'days / year' ) );
	$a[14] = array( telco_cell( 'B14', 'Trading days per month' ), telco_cell( 'C14', $days, 'C13/12', 0 ), telco_cell( 'D14', 'days / month' ) );
	$a[16] = array( telco_cell( 'A16', 'Derived', null, 1 ) );
	$a[17] = array( telco_cell( 'B17', 'Annual guests, all venues' ), telco_cell( 'C17', $c['guestsYear'], 'C4*C5*C13', 4 ), telco_cell( 'D17', 'guests / year' ) );
	$a[18] = array( telco_cell( 'B18', 'Annual guests reached by personalised offers' ), telco_cell( 'C18', $c['reachedYear'], 'C17*C9', 4 ), telco_cell( 'D18', 'guests / year' ) );
	$a[19] = array( telco_cell( 'B19', 'Years modelled' ), telco_cell( 'C19', (float) ( PUBS_MONTHS / 12 ), null, 0 ), telco_cell( 'D19', 'years (36 months)' ) );
	$a[21] = array( telco_cell( 'A21', 'Notes', null, 1 ) );
	$a[22] = array( telco_cell( 'A22', 'All figures are in USD. They are estimates based on the values entered on personalisationhub.com, not a guarantee. Yellow cells are inputs; everything else is calculated.' ) );
	$a[23] = array( telco_cell( 'A23', 'Only guests reached by personalised offers earn the uplift; the rest of the estate is unchanged.' ) );
	$a[24] = array( telco_cell( 'A24', 'Targeting uses the venue\'s own customer and loyalty data, or aggregate data only.' ) );

	/* Monthly model. Months in columns C..AL (3..38); totals AM..AP (39..42). */
	$m    = array();
	$m[1] = array( telco_cell( 'A1', '3-year monthly model: incremental revenue from personalised offers', null, 7 ) );
	$m[3] = array( telco_cell( 'A3', 'Metric', null, 1 ), telco_cell( 'B3', 'Unit', null, 1 ) );
	$m[4] = array();
	for ( $i = 1; $i <= PUBS_MONTHS; $i++ ) {
		$m[4][] = telco_cell( telco_col( $i + 2 ) . '4', $i, null, 1 );
	}
	foreach ( array( 'Year 1 total', 'Year 2 total', 'Year 3 total', '3-year total' ) as $k => $t ) {
		$m[4][] = telco_cell( telco_col( 39 + $k ) . '4', $t, null, 1 );
	}
	$labels = array(
		6  => array( 'INCREMENTAL REVENUE FROM PERSONALISED OFFERS', '' ),
		7  => array( 'Venues', 'venues' ),
		8  => array( 'Guests per venue per day', 'guests/day' ),
		9  => array( 'Trading days this month', 'days' ),
		10 => array( 'Guests this month, all venues', 'guests' ),
		11 => array( 'Share of guests reached by personalised offers', '%' ),
		12 => array( 'Guests reached this month', 'guests' ),
		13 => array( 'Average revenue per head', '$' ),
		14 => array( 'Uplift in revenue per head', '%' ),
		15 => array( 'Incremental revenue per guest reached', '$' ),
		17 => array( 'MONTHLY INCREMENTAL REVENUE: TOTAL', '$' ),
	);
	foreach ( $labels as $r => $l ) {
		$bold    = in_array( $r, array( 6, 17 ), true ) ? 1 : 0;
		$m[ $r ] = array( telco_cell( 'A' . $r, $l[0], null, $bold ), telco_cell( 'B' . $r, $l[1], null, 0 ) );
	}
	$guestsM  = $v['venues'] * $v['guests'] * $days;
	$reachedM = $guestsM * $reach;
	$perGuest = $v['revenue'] * $up;
	for ( $i = 1; $i <= PUBS_MONTHS; $i++ ) {
		$L   = telco_col( $i + 2 );
		$put = function ( $r, $val, $f, $s ) use ( &$m, $L ) {
			$m[ $r ][] = telco_cell( $L . $r, $val, $f, $s );
		};
		$put( 7, (float) $v['venues'], 'Assumptions!$C$4', 4 );
		$put( 8, (float) $v['guests'], 'Assumptions!$C$5', 4 );
		$put( 9, $days, 'Assumptions!$C$14', 0 );
		$put( 10, $guestsM, "{$L}7*{$L}8*{$L}9", 4 );
		$put( 11, $reach, 'Assumptions!$C$9', 5 );
		$put( 12, $reachedM, "{$L}10*{$L}11", 4 );
		$put( 13, (float) $v['revenue'], 'Assumptions!$C$6', 3 );
		$put( 14, $up, 'Assumptions!$C$10', 5 );
		$put( 15, $perGuest, "{$L}13*{$L}14", 0 );
		$put( 17, $mo, "{$L}12*{$L}15", 6 );
	}
	// Totals columns: sums of the months for flows; 3-year = sum of the three years.
	$ranges = array( array( 'C', 'N' ), array( 'O', 'Z' ), array( 'AA', 'AL' ) );
	$flow   = array( 9 => array( $days, 0 ), 10 => array( $guestsM, 4 ), 12 => array( $reachedM, 4 ), 17 => array( $mo, 6 ) );
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
	$s[3] = array( telco_cell( 'A3', 'Annual incremental revenue (USD)', null, 1 ) );
	$s[4] = array( telco_cell( 'A4', 'Year', null, 1 ), telco_cell( 'B4', 'Guests reached', null, 1 ), telco_cell( 'C4', 'Incremental revenue ($)', null, 1 ), telco_cell( 'D4', 'Cumulative revenue ($)', null, 1 ) );
	$cols = array( 'AM', 'AN', 'AO' );
	for ( $y = 0; $y < 3; $y++ ) {
		$r       = 5 + $y;
		$yr      = $c['years'][ $y ];
		$s[ $r ] = array(
			telco_cell( 'A' . $r, 'Year ' . ( $y + 1 ) ),
			telco_cell( 'B' . $r, 12 * $reachedM, $M . $cols[ $y ] . '12', 4 ),
			telco_cell( 'C' . $r, $yr['total'], $M . $cols[ $y ] . '17', 3 ),
			telco_cell( 'D' . $r, $yr['cum'], 0 === $y ? 'C5' : 'D' . ( $r - 1 ) . '+C' . $r, 3 ),
		);
	}
	$s[8]  = array( telco_cell( 'A8', '3-year total', null, 1 ), telco_cell( 'B8', 36 * $reachedM, 'SUM(B5:B7)', 4 ), telco_cell( 'C8', $c['total'], 'SUM(C5:C7)', 6 ), telco_cell( 'D8', $c['total'], 'D7', 6 ) );
	$s[10] = array( telco_cell( 'A10', 'Key metrics', null, 1 ) );
	$s[11] = array( telco_cell( 'A11', 'Monthly revenue run-rate (month 36)' ), telco_cell( 'C11', $c['runRate'], $M . 'AL17', 3 ) );
	$s[12] = array( telco_cell( 'A12', 'Uplift per venue per year (3-year average)' ), telco_cell( 'C12', $c['total'] / 3 / $v['venues'], 'C8/3/Assumptions!C4', 3 ) );
	$s[13] = array( telco_cell( 'A13', 'Uplift per guest reached' ), telco_cell( 'C13', $perGuest, 'IF(B8=0,0,C8/B8)', 0 ) );
	$s[15] = array( telco_cell( 'A15', 'Estimates based on the values entered on personalisationhub.com, in USD. Not a guarantee.' ) );

	/* Sensitivity: 3-year total at three reach levels against three uplifts, every cell a live formula. */
	$sn    = array();
	$sn[1] = array( telco_cell( 'A1', 'Sensitivity: 3-year incremental revenue (USD)', null, 7 ) );
	$sn[3] = array( telco_cell( 'A3', 'Share of guests reached (down) against uplift in revenue per head (across). Other inputs as on the Assumptions sheet.' ) );
	$ups   = array( 0.025, 0.05, 0.075 );
	$reach3 = array( 0.4, 0.6, 0.8 );
	$sn[4] = array( telco_cell( 'A4', 'Reach / uplift', null, 1 ) );
	foreach ( $ups as $k => $u ) {
		$sn[4][] = telco_cell( telco_col( 2 + $k ) . '4', $u, null, 5 );
	}
	foreach ( $reach3 as $j => $rc ) {
		$r        = 5 + $j;
		$sn[ $r ] = array( telco_cell( 'A' . $r, $rc, null, 5 ) );
		foreach ( $ups as $k => $u ) {
			$L          = telco_col( 2 + $k );
			$val        = $c['guestsYear'] * $rc * $v['revenue'] * $u * 3;
			$f          = "Assumptions!\$C\$17*\$A{$r}*Assumptions!\$C\$6*{$L}\$4*Assumptions!\$C\$19";
			$sn[ $r ][] = telco_cell( $L . $r, $val, $f, 3 );
		}
	}
	$sn[9] = array( telco_cell( 'A9', 'Estimates, not a guarantee.' ) );

	$wide  = '<cols><col min="1" max="1" width="48" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="42" width="14" customWidth="1"/></cols>';
	$names = array(
		'Venues' => 'C4', 'GuestsPerVenueDay' => 'C5', 'RevenuePerHead' => 'C6', 'GuestReach' => 'C9', 'RevenuePerHeadUplift' => 'C10',
		'TradingDaysYear' => 'C13', 'TradingDaysMonth' => 'C14', 'AnnualGuests' => 'C17', 'AnnualGuestsReached' => 'C18',
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
	$tmp = function_exists( 'wp_tempnam' ) ? wp_tempnam( 'pubs-model' ) : tempnam( sys_get_temp_dir(), 'pubs' );
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
