<?php
/**
 * PH Consent config: the one list the banner, the Preferences panel, the audit log and /cookie-policy/ all read.
 * Bump 'policy' when a cookie, vendor or purpose changes: everyone is asked again.
 * 'verified' false = taken from the vendor's documentation, not yet measured on the live site (the deploy session measures them).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

return [
	'policy'     => '2026-11-05',
	'cookie'     => 'ph_consent',
	'months'     => 12,
	'purge'      => 24,
	// Where Google Consent Mode defaults to denied (EU/EEA, UK, Switzerland). Everywhere else is granted with the lighter notice.
	'eu'         => [ 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH' ],
	'categories' => [
		'necessary' => [ 'label' => 'Necessary', 'desc' => 'Remember your cookie choice and make the site and demo booking work. Always on.' ],
		'analytics' => [ 'label' => 'Analytics', 'desc' => 'Show us how the site is used so we can improve it (Google Analytics).' ],
		'marketing' => [ 'label' => 'Marketing', 'desc' => 'Measure our advertising and show relevant ads to people who have visited (Google Ads, LinkedIn, Meta).' ],
	],
	'vendors'    => [
		'ph'       => [ 'name' => 'Personalisation Hub', 'url' => 'https://personalisationhub.com/privacy-policy/' ],
		'google'   => [ 'name' => 'Google', 'url' => 'https://policies.google.com/privacy' ],
		'linkedin' => [ 'name' => 'LinkedIn', 'url' => 'https://www.linkedin.com/legal/privacy-policy' ],
		'meta'     => [ 'name' => 'Meta', 'url' => 'https://www.facebook.com/privacy/policy/' ],
		'calendly' => [ 'name' => 'Calendly', 'url' => 'https://calendly.com/privacy' ],
	],
	'cookies'    => [
		[ 'name' => 'ph_consent', 'vendor' => 'ph', 'purpose' => 'Stores your cookie choice', 'category' => 'necessary', 'duration' => '12 months', 'verified' => true ],
		[ 'name' => 'ph_geo (browser storage)', 'vendor' => 'ph', 'purpose' => 'Remembers your country so we show the right cookie notice', 'category' => 'necessary', 'duration' => '7 days', 'verified' => true ],
		[ 'name' => '_ga', 'vendor' => 'google', 'purpose' => 'Tells visits apart to measure site use', 'category' => 'analytics', 'duration' => '2 years', 'verified' => false ],
		[ 'name' => '_ga_*', 'vendor' => 'google', 'purpose' => 'Keeps session state for Google Analytics', 'category' => 'analytics', 'duration' => '2 years', 'verified' => false ],
		[ 'name' => '_gcl_au', 'vendor' => 'google', 'purpose' => 'Measures how well Google Ads lead to enquiries', 'category' => 'marketing', 'duration' => '3 months', 'verified' => false ],
		[ 'name' => 'li_fat_id, bcookie, lidc, UserMatchHistory', 'vendor' => 'linkedin', 'purpose' => 'LinkedIn Insight Tag: ad measurement and remarketing (only once added, and only after you accept marketing)', 'category' => 'marketing', 'duration' => 'Up to 6 months', 'verified' => false ],
		[ 'name' => '_fbp', 'vendor' => 'meta', 'purpose' => 'Meta Pixel: ad measurement and remarketing (only once added, and only after you accept marketing)', 'category' => 'marketing', 'duration' => '3 months', 'verified' => false ],
		[ 'name' => '_calendly_session', 'vendor' => 'calendly', 'purpose' => 'Set by the demo booking widget on pages that have one', 'category' => 'necessary', 'duration' => '21 days', 'verified' => false ],
	],
];
