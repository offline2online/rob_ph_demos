<?php
/** php ph-website/tests/franchise-render.php : prints the [ph_franchise] page body (franchise_html()) for the Chromium fixture. */
namespace {
define( 'ABSPATH', '/' );
define( 'PH_FRANCHISE_TEST', 1 );
function esc_attr( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES ); }
function esc_html( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES ); }
require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/franchise.php';
echo \AngieSnippets\PhIndustryEnhancements_10063\franchise_html();
}
