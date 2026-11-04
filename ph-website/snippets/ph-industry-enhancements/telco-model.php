<?php
/**
 * Telco business model: the one set of assumptions and formulas behind the on-page calculator (enhance.js),
 * the gated .xlsx download and, later, the PH MCP business-model tool.
 *
 * - spec()  : inputs, defaults, limits, fixed assumptions. Printed to the page as window.PH_TELCO_MODEL.
 * - calc()  : the formulas. enhance.js (telcoCalc) mirrors them; tests/telco-model.test.* keep the two equal.
 * - xlsx()  : the downloadable workbook, pre-filled with the visitor's values and live formulas.
 * - REST    : POST ph-site/v1/telco-model (lead gate) and GET ph-site/v1/telco-model/download (signed link).
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_TELCO_MODEL_TEST' ) ) {
	exit;
}

/** Standard trading days per year. Fixed, not an input. */
const TELCO_OP_DAYS_YEAR = 250;
const TELCO_MONTHS       = 36;

function telco_spec() {
	return array(
		'opDaysYear' => TELCO_OP_DAYS_YEAR,
		'months'     => TELCO_MONTHS,
		'fields'     => array(
			array( 'id' => 'stores', 'label' => 'Number of stores', 'def' => 58, 'min' => 1, 'max' => 5000, 'step' => 1 ),
			array( 'id' => 'footfall', 'label' => 'Existing walk-ins per store per day', 'def' => 95, 'min' => 1, 'max' => 2000, 'step' => 5 ),
			array( 'id' => 'conv', 'label' => 'Baseline in-store conversion rate (%)', 'def' => 15, 'min' => 1, 'max' => 90, 'step' => 0.5 ),
			array( 'id' => 'arpu', 'label' => 'Average ARPU per converted customer ($ / month)', 'def' => 49, 'min' => 1, 'max' => 1000, 'step' => 1 ),
			array( 'id' => 'walk', 'label' => 'Incremental walk-ins per store per day from campaigns', 'def' => 1, 'min' => 0, 'max' => 20, 'step' => 0.5 ),
			array( 'id' => 'uplift', 'label' => 'Conversion uplift from targeted offers (%)', 'def' => 15, 'min' => 0, 'max' => 50, 'step' => 1 ),
			array( 'id' => 'churn', 'label' => 'Monthly customer churn rate (%)', 'def' => 2, 'min' => 0, 'max' => 10, 'step' => 0.5 ),
		),
	);
}

/** Clamp a submitted value set to the spec; missing or bad values fall back to the default. */
function telco_clean( $in ) {
	$out = array();
	foreach ( telco_spec()['fields'] as $f ) {
		$v = is_array( $in ) && isset( $in[ $f['id'] ] ) && is_numeric( $in[ $f['id'] ] ) ? (float) $in[ $f['id'] ] : (float) $f['def'];
		$out[ $f['id'] ] = max( $f['min'], min( $f['max'], $v ) );
	}
	return $out;
}

/** Month-by-month model. Same formulas as the workbook. Percentages are whole numbers (15 = 15%). */
function telco_calc( $v ) {
	$days   = TELCO_OP_DAYS_YEAR / 12;
	$conv   = $v['conv'] / 100;
	$upconv = $conv * ( 1 + $v['uplift'] / 100 );
	$churn  = $v['churn'] / 100;
	$m      = array();
	$b1     = 0.0;
	$b2     = 0.0;
	for ( $i = 1; $i <= TELCO_MONTHS; $i++ ) {
		$n1 = $v['stores'] * $v['walk'] * $days * $conv;
		$n2 = $v['stores'] * $v['footfall'] * ( $upconv - $conv ) * $days;
		$b1 = 1 === $i ? $n1 : $b1 * ( 1 - $churn ) + $n1;
		$b2 = 1 === $i ? $n2 : $b2 * ( 1 - $churn ) + $n2;
		$m[ $i ] = array( 'n1' => $n1, 'b1' => $b1, 'r1' => $b1 * $v['arpu'], 'n2' => $n2, 'b2' => $b2, 'r2' => $b2 * $v['arpu'] );
	}
	$years = array();
	$cum   = 0.0;
	for ( $y = 0; $y < 3; $y++ ) {
		$s1 = 0.0;
		$s2 = 0.0;
		for ( $i = $y * 12 + 1; $i <= $y * 12 + 12; $i++ ) {
			$s1 += $m[ $i ]['r1'];
			$s2 += $m[ $i ]['r2'];
		}
		$cum    += $s1 + $s2;
		$years[] = array( 's1' => $s1, 's2' => $s2, 'total' => $s1 + $s2, 'cum' => $cum );
	}
	return array(
		'months'  => $m,
		'years'   => $years,
		'total'   => $cum,
		'runRate' => $m[ TELCO_MONTHS ]['r1'] + $m[ TELCO_MONTHS ]['r2'],
		'base'    => $m[ TELCO_MONTHS ]['b1'] + $m[ TELCO_MONTHS ]['b2'],
	);
}

/* ------------------------------------------------------------------ workbook */

function telco_col( $n ) { // 1 => A
	$s = '';
	while ( $n > 0 ) {
		$r = ( $n - 1 ) % 26;
		$s = chr( 65 + $r ) . $s;
		$n = intdiv( $n - 1, 26 );
	}
	return $s;
}

/** A cell: [ref, value, formula|null, style]. Strings go inline; numbers carry the cached value. */
function telco_cell( $ref, $val, $f = null, $s = 0 ) {
	$fx = null === $f ? '' : '<f>' . htmlspecialchars( $f, ENT_XML1 ) . '</f>';
	if ( is_string( $val ) && null === $f ) {
		return '<c r="' . $ref . '" s="' . $s . '" t="inlineStr"><is><t xml:space="preserve">' . htmlspecialchars( $val, ENT_XML1 ) . '</t></is></c>';
	}
	return '<c r="' . $ref . '" s="' . $s . '">' . $fx . '<v>' . ( is_float( $val ) ? sprintf( '%.12F', $val ) : $val ) . '</v></c>';
}

function telco_sheet( $rows, $cols = '' ) {
	ksort( $rows );
	$x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' . $cols . '<sheetData>';
	foreach ( $rows as $r => $cells ) {
		$x .= '<row r="' . $r . '">' . implode( '', $cells ) . '</row>';
	}
	return $x . '</sheetData></worksheet>';
}

/** styles: 0 plain, 1 bold, 2 input (yellow), 3 $ , 4 number, 5 percent, 6 bold $, 7 title, 8 input percent. */
function telco_styles() {
	return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
		. '<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>'
		. '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>'
		. '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill></fills>'
		. '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
		. '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
		. '<cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
		. '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
		. '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>'
		. '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
		. '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
		. '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
		. '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
		. '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="10" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/></cellXfs></styleSheet>';
}

/** Build the workbook bytes for a cleaned value set. Returns '' if ZipArchive is missing. */
function telco_xlsx( $v ) {
	if ( ! class_exists( '\ZipArchive' ) ) {
		return '';
	}
	$c    = telco_calc( $v );
	$days = TELCO_OP_DAYS_YEAR / 12;
	$conv = $v['conv'] / 100;
	$up   = $conv * ( 1 + $v['uplift'] / 100 );

	/* Assumptions: the yellow cells are the visitor's own values; the rest follows. */
	$a   = array();
	$a[1] = array( telco_cell( 'A1', 'Assumptions: edit yellow cells only', null, 7 ) );
	$a[3] = array( telco_cell( 'A3', 'Store footprint and trading', null, 1 ) );
	$a[4] = array( telco_cell( 'B4', 'Number of stores' ), telco_cell( 'C4', (float) $v['stores'], null, 2 ), telco_cell( 'D4', 'stores' ) );
	$a[5] = array( telco_cell( 'B5', 'Store operating days per year (standard)' ), telco_cell( 'C5', TELCO_OP_DAYS_YEAR, null, 0 ), telco_cell( 'D5', 'days / year' ) );
	$a[6] = array( telco_cell( 'B6', 'Average operating days per month' ), telco_cell( 'C6', $days, 'C5/12', 0 ), telco_cell( 'D6', 'days / month' ) );
	$a[8] = array( telco_cell( 'A8', 'Baseline in-store conversion', null, 1 ) );
	$a[9] = array( telco_cell( 'B9', 'Baseline in-store conversion rate' ), telco_cell( 'C9', $conv, null, 8 ), telco_cell( 'D9', '%' ) );
	$a[10] = array( telco_cell( 'B10', 'In-store conversion uplift from targeted offers (Stream 2)' ), telco_cell( 'C10', $v['uplift'] / 100, null, 8 ), telco_cell( 'D10', '%' ) );
	$a[11] = array( telco_cell( 'B11', 'Uplifted in-store conversion rate' ), telco_cell( 'C11', $up, 'C9*(1+C10)', 5 ), telco_cell( 'D11', '%' ) );
	$a[13] = array( telco_cell( 'A13', 'Stream 1: walk-in campaign impact', null, 1 ) );
	$a[14] = array( telco_cell( 'B14', 'Incremental walk-in customers per store per day' ), telco_cell( 'C14', (float) $v['walk'], null, 2 ), telco_cell( 'D14', 'customers / store / day' ) );
	$a[16] = array( telco_cell( 'A16', 'Stream 2: existing store footfall', null, 1 ) );
	$a[17] = array( telco_cell( 'B17', 'Average existing daily walk-ins per store (baseline foot traffic)' ), telco_cell( 'C17', (float) $v['footfall'], null, 2 ), telco_cell( 'D17', 'customers / store / day' ) );
	$a[19] = array( telco_cell( 'A19', 'Revenue and retention', null, 1 ) );
	$a[20] = array( telco_cell( 'B20', 'Average ARPU per converted customer (postpaid mobile)' ), telco_cell( 'C20', (float) $v['arpu'], null, 2 ), telco_cell( 'D20', '$ / month' ) );
	$a[21] = array( telco_cell( 'B21', 'Monthly customer churn rate' ), telco_cell( 'C21', $v['churn'] / 100, null, 8 ), telco_cell( 'D21', '%' ) );
	$a[23] = array( telco_cell( 'A23', 'Estimates based on the values entered on personalisationhub.com. Not a guarantee. Yellow cells are inputs; everything else is calculated.' ) );

	/* Monthly model. Months in columns C..AL (3..38); totals AM..AP (39..42). */
	$m = array();
	$m[1] = array( telco_cell( 'A1', '3-year monthly model: Stream 1 + Stream 2 combined', null, 7 ) );
	$m[3] = array( telco_cell( 'A3', 'Metric', null, 1 ), telco_cell( 'B3', 'Unit', null, 1 ) );
	$m[4] = array();
	for ( $i = 1; $i <= TELCO_MONTHS; $i++ ) {
		$m[4][] = telco_cell( telco_col( $i + 2 ) . '4', $i, null, 1 );
	}
	foreach ( array( 'Year 1 total', 'Year 2 total', 'Year 3 total', '3-year total' ) as $k => $t ) {
		$m[4][] = telco_cell( telco_col( 39 + $k ) . '4', $t, null, 1 );
	}
	$labels = array(
		6  => array( 'STREAM 1: INCREMENTAL WALK-IN REVENUE', '' ),
		7  => array( 'Operating days this month', 'days' ),
		8  => array( 'Stores', 'stores' ),
		9  => array( 'Incremental walk-ins / store / day', 'cust/store/day' ),
		10 => array( 'Total incremental daily walk-ins', 'cust/day' ),
		11 => array( 'Incremental monthly walk-ins', 'customers' ),
		12 => array( 'Baseline conversion rate', '%' ),
		13 => array( 'New customers this month', 'customers' ),
		14 => array( 'Installed base (subscribers)', 'subscribers' ),
		15 => array( 'Stream 1 incremental monthly revenue', '$' ),
		17 => array( 'STREAM 2: INCREMENTAL IN-STORE CONVERSION', '' ),
		18 => array( 'Total baseline daily footfall', 'cust/day' ),
		19 => array( 'Baseline conversion rate', '%' ),
		20 => array( 'Uplifted conversion rate', '%' ),
		21 => array( 'Conversion rate uplift', 'pp' ),
		22 => array( 'Incremental daily conversions', 'cust/day' ),
		23 => array( 'New customers this month', 'customers' ),
		24 => array( 'Installed base (subscribers)', 'subscribers' ),
		25 => array( 'Stream 2 incremental monthly revenue', '$' ),
		27 => array( 'COMBINED: STREAM 1 + STREAM 2', '' ),
		28 => array( 'Combined new customers this month', 'customers' ),
		29 => array( 'Combined installed base (subscribers)', 'subscribers' ),
		30 => array( 'COMBINED MONTHLY REVENUE: TOTAL', '$' ),
	);
	foreach ( $labels as $r => $l ) {
		$bold = in_array( $r, array( 6, 17, 27, 30 ), true ) ? 1 : 0;
		$m[ $r ] = array( telco_cell( 'A' . $r, $l[0], null, $bold ), telco_cell( 'B' . $r, $l[1], null, 0 ) );
	}
	for ( $i = 1; $i <= TELCO_MONTHS; $i++ ) {
		$L = telco_col( $i + 2 );
		$P = telco_col( $i + 1 );
		$d = $c['months'][ $i ];
		$w = $v['stores'] * $v['walk'];
		$put = function ( $r, $val, $f, $s ) use ( &$m, $L ) {
			$m[ $r ][] = telco_cell( $L . $r, $val, $f, $s );
		};
		$put( 7, $days, 'Assumptions!$C$6', 0 );
		$put( 8, (float) $v['stores'], 'Assumptions!$C$4', 4 );
		$put( 9, (float) $v['walk'], 'Assumptions!$C$14', 0 );
		$put( 10, $w, "{$L}8*{$L}9", 4 );
		$put( 11, $w * $days, "{$L}10*{$L}7", 4 );
		$put( 12, $conv, 'Assumptions!$C$9', 5 );
		$put( 13, $d['n1'], "{$L}11*{$L}12", 4 );
		$put( 14, $d['b1'], 1 === $i ? "{$L}13" : "{$P}14*(1-Assumptions!\$C\$21)+{$L}13", 4 );
		$put( 15, $d['r1'], "{$L}14*Assumptions!\$C\$20", 3 );
		$put( 18, $v['stores'] * $v['footfall'], 'Assumptions!$C$4*Assumptions!$C$17', 4 );
		$put( 19, $conv, 'Assumptions!$C$9', 5 );
		$put( 20, $up, 'Assumptions!$C$11', 5 );
		$put( 21, $up - $conv, "{$L}20-{$L}19", 5 );
		$put( 22, $v['stores'] * $v['footfall'] * ( $up - $conv ), "{$L}18*{$L}21", 4 );
		$put( 23, $d['n2'], "{$L}22*{$L}7", 4 );
		$put( 24, $d['b2'], 1 === $i ? "{$L}23" : "{$P}24*(1-Assumptions!\$C\$21)+{$L}23", 4 );
		$put( 25, $d['r2'], "{$L}24*Assumptions!\$C\$20", 3 );
		$put( 28, $d['n1'] + $d['n2'], "{$L}13+{$L}23", 4 );
		$put( 29, $d['b1'] + $d['b2'], "{$L}14+{$L}24", 4 );
		$put( 30, $d['r1'] + $d['r2'], "{$L}15+{$L}25", 6 );
	}
	// Totals columns: sums for flows, last month for the installed base, 3-year = sum of years.
	$ranges = array( array( 'C', 'N' ), array( 'O', 'Z' ), array( 'AA', 'AL' ) );
	$flow   = array( 11 => 'n1w', 13 => 'n1', 15 => 'r1', 23 => 'n2', 25 => 'r2', 28 => 'n', 30 => 'r' );
	$base   = array( 14 => 'b1', 24 => 'b2', 29 => 'b' );
	$val    = function ( $i, $k ) use ( $c, $v, $days ) {
		$d = $c['months'][ $i ];
		switch ( $k ) {
			case 'n1w':
				return $v['stores'] * $v['walk'] * $days;
			case 'n':
				return $d['n1'] + $d['n2'];
			case 'r':
				return $d['r1'] + $d['r2'];
			case 'b':
				return $d['b1'] + $d['b2'];
			default:
				return $d[ $k ];
		}
	};
	foreach ( $flow as $r => $k ) {
		$tot = 0.0;
		for ( $y = 0; $y < 3; $y++ ) {
			$s = 0.0;
			for ( $i = $y * 12 + 1; $i <= $y * 12 + 12; $i++ ) {
				$s += $val( $i, $k );
			}
			$tot    += $s;
			$m[ $r ][] = telco_cell( telco_col( 39 + $y ) . $r, $s, "SUM({$ranges[$y][0]}{$r}:{$ranges[$y][1]}{$r})", in_array( $r, array( 15, 25, 30 ), true ) ? 3 : 4 );
		}
		$m[ $r ][] = telco_cell( 'AP' . $r, $tot, "AM{$r}+AN{$r}+AO{$r}", in_array( $r, array( 15, 25, 30 ), true ) ? 3 : 4 );
	}
	foreach ( $base as $r => $k ) {
		foreach ( array( 12, 24, 36 ) as $y => $i ) {
			$m[ $r ][] = telco_cell( telco_col( 39 + $y ) . $r, $val( $i, $k ), telco_col( $i + 2 ) . $r, 4 );
		}
	}
	foreach ( $m as $r => $cells ) { // cells must run left to right within a row.
		usort( $m[ $r ], function ( $x, $y ) {
			preg_match( '/r="([A-Z]+)/', $x, $a );
			preg_match( '/r="([A-Z]+)/', $y, $b );
			return strlen( $a[1] ) <=> strlen( $b[1] ) ?: strcmp( $a[1], $b[1] );
		} );
	}

	/* Summary. */
	$M  = "'3-Year Monthly Model'!";
	$s  = array();
	$s[1] = array( telco_cell( 'A1', '3-year summary', null, 7 ) );
	$s[3] = array( telco_cell( 'A3', 'Annual incremental revenue by stream', null, 1 ) );
	$s[4] = array( telco_cell( 'A4', 'Year', null, 1 ), telco_cell( 'B4', 'Stream 1: incremental walk-in revenue ($)', null, 1 ), telco_cell( 'C4', 'Stream 2: incremental in-store conversion revenue ($)', null, 1 ), telco_cell( 'D4', 'Total incremental revenue ($)', null, 1 ), telco_cell( 'E4', 'Cumulative revenue ($)', null, 1 ) );
	$cols = array( 'AM', 'AN', 'AO' );
	for ( $y = 0; $y < 3; $y++ ) {
		$r = 5 + $y;
		$yr = $c['years'][ $y ];
		$s[ $r ] = array(
			telco_cell( 'A' . $r, 'Year ' . ( $y + 1 ) ),
			telco_cell( 'B' . $r, $yr['s1'], $M . $cols[ $y ] . '15', 3 ),
			telco_cell( 'C' . $r, $yr['s2'], $M . $cols[ $y ] . '25', 3 ),
			telco_cell( 'D' . $r, $yr['total'], $M . $cols[ $y ] . '30', 3 ),
			telco_cell( 'E' . $r, $yr['cum'], 0 === $y ? 'D5' : 'E' . ( $r - 1 ) . '+D' . $r, 3 ),
		);
	}
	$s[8]  = array( telco_cell( 'A8', '3-year total', null, 1 ), telco_cell( 'B8', array_sum( array_column( $c['years'], 's1' ) ), 'SUM(B5:B7)', 6 ), telco_cell( 'C8', array_sum( array_column( $c['years'], 's2' ) ), 'SUM(C5:C7)', 6 ), telco_cell( 'D8', $c['total'], 'SUM(D5:D7)', 6 ), telco_cell( 'E8', $c['total'], 'E7', 6 ) );
	$s[10] = array( telco_cell( 'A10', 'Key metrics', null, 1 ) );
	$s[11] = array( telco_cell( 'A11', 'Combined monthly revenue run-rate (month 36)' ), telco_cell( 'D11', $c['runRate'], $M . 'AL30', 3 ) );
	$s[12] = array( telco_cell( 'A12', 'Combined installed base of incremental subscribers (month 36)' ), telco_cell( 'D12', $c['base'], $M . 'AL29', 4 ) );
	$s[13] = array( telco_cell( 'A13', '3-year cumulative incremental revenue (both streams)' ), telco_cell( 'D13', $c['total'], 'E7', 3 ) );
	$s[15] = array( telco_cell( 'A15', 'Estimates based on the values entered on personalisationhub.com. Not a guarantee.' ) );

	$wide = '<cols><col min="1" max="1" width="48" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="42" width="14" customWidth="1"/></cols>';
	$names = array( 'Stores' => 'C4', 'OpDaysYear' => 'C5', 'OpDaysMonth' => 'C6', 'BaseConv' => 'C9', 'ConvUplift' => 'C10', 'UpliftConv' => 'C11', 'WalkinPerStoreDay' => 'C14', 'BaselineFootfallPerStoreDay' => 'C17', 'ARPU' => 'C20', 'MonthlyChurn' => 'C21' );
	$dn    = '';
	foreach ( $names as $n => $ref ) {
		$dn .= '<definedName name="' . $n . '">Assumptions!$' . $ref[0] . '$' . substr( $ref, 1 ) . '</definedName>';
	}
	$files = array(
		'[Content_Types].xml'        => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
		'_rels/.rels'                => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
		'xl/workbook.xml'            => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Assumptions" sheetId="1" r:id="rId1"/><sheet name="3-Year Monthly Model" sheetId="2" r:id="rId2"/><sheet name="3-Year Summary" sheetId="3" r:id="rId3"/></sheets><definedNames>' . $dn . '</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
		'xl/_rels/workbook.xml.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
		'xl/styles.xml'              => telco_styles(),
		'xl/worksheets/sheet1.xml'   => telco_sheet( $a, $wide ),
		'xl/worksheets/sheet2.xml'   => telco_sheet( $m, $wide ),
		'xl/worksheets/sheet3.xml'   => telco_sheet( $s, $wide ),
	);
	$tmp = function_exists( 'wp_tempnam' ) ? wp_tempnam( 'telco-model' ) : tempnam( sys_get_temp_dir(), 'telco' );
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
