<?php
/**
 * AI search hygiene for the home page, the feature pages and the industry pages (loaded from main.php).
 * Adds, on those pages only: a plain-language opening summary, question-phrased fact headings built from
 * facts that are live today, a visible last-updated date, internal links to related pages, and a unique
 * description only where the page's own SEOPress description is empty or duplicated. Curated SEOPress titles and
 * descriptions are never replaced. Wording is kept to live capabilities and spells personalisation with an S.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const AI_SHARED_FACTS = [
	'Deployment'   => 'Self-hosted in your own AWS account (VPC) and on your own domain.',
	'Devices'      => 'Any digital signage device, alongside your existing app and systems.',
	'Installation time' => 'Typical installation takes about 1 hour 15 minutes, as stated on the AWS Marketplace listing.',
	'Try it'       => '30-day free trial on AWS Marketplace, then billed through your AWS account.',
];

/** Feature and home pages: path => [ name, tagline used in the meta description ]. */
function ai_feature_pages() {
	return [
		'/'                              => [ 'Personalisation Hub', 'Self-hosted personalisation for stores, venues and branches' ],
		'digital-signage'                => [ 'Digital Signage', 'Personalised screens that react to live store context' ],
		'retail-queue-management'        => [ 'Queue Management', 'Virtual queues that keep customers moving' ],
		'retail-appointment-bookings'    => [ 'Appointment Booking', 'Appointments booked from the screens and sites you already run' ],
		'retail-media-platform'          => [ 'Retail Media Platform', 'Your own screens, with measurable results from screen to sale' ],
		'store-sites'                    => [ 'Store Sites', 'A mobile site for every store, personalised for each visitor' ],
		'personalisation'                => [ 'Personalisation', 'Live store context combined with your own customer data' ],
		'localisation-geo-targeting'     => [ 'Localisation and Geo-Targeting', 'The right message for the right store and location' ],
		'ai-agents'                      => [ 'AI Agents', 'AI agents working alongside the platform' ],
	];
}

function ai_industry_names() {
	return [
		'industries'  => 'Industries', 'convenience' => 'Fuel & Convenience', 'hospitality' => 'Pubs & Hospitality', 'telco' => 'Telco Retail',
		'pharmacy' => 'Pharmacy', 'retail-media' => 'Retail Media', 'grocery' => 'Grocery & Supermarkets', 'fashion' => 'Fashion & Department Stores',
		'qsr' => 'Quick Service Restaurants', 'banking' => 'Banking',
	];
}

/** [ type, key ] for the current page, or null. type is home|feature|industry. */
function ai_page() {
	if ( ! is_page() ) {
		return null;
	}
	$key = page_key();
	if ( '' !== $key ) {
		return [ 'industry', $key ];
	}
	if ( is_front_page() ) {
		return [ 'home', '/' ];
	}
	$post = get_queried_object();
	if ( $post instanceof \WP_Post ) {
		$uri = trim( (string) get_page_uri( $post ), '/' );
		if ( isset( ai_feature_pages()[ $uri ] ) && '/' !== $uri ) {
			return [ 'feature', $uri ];
		}
	}
	return null;
}

function ai_url( $type, $key ) {
	if ( 'industry' === $type ) {
		return page_url( $key );
	}
	return '/' === $key ? home_url( '/' ) : home_url( '/' . $key . '/' );
}

/** Key facts as label => text. Industry pages read them from their markdown twin, so the two never disagree. */
function ai_facts( $type, $key ) {
	if ( 'industry' === $type ) {
		$md    = data( 'md.php' );
		$facts = [];
		if ( isset( $md[ $key ] ) && preg_match( '/## Key facts\n(.*?)(\n\n|\n##|$)/s', $md[ $key ], $m ) ) {
			foreach ( explode( "\n", trim( $m[1] ) ) as $line ) {
				if ( preg_match( '/^- \*\*(.+?):\*\* (.+)$/', $line, $p ) ) {
					$facts[ $p[1] ] = $p[2];
				}
			}
		}
		return $facts + [ 'Installation time' => AI_SHARED_FACTS['Installation time'] ];
	}
	$facts = [
		'Best for'    => 'Businesses with physical locations: stores, venues and branches',
		'Data used'   => 'Time, weather and stock, plus your own CDP, CRM, loyalty and decisioning data',
	];
	return $facts + AI_SHARED_FACTS;
}

function ai_summary( $type, $key ) {
	if ( 'industry' === $type ) {
		$md = data( 'md.php' );
		if ( isset( $md[ $key ] ) ) {
			$parts = explode( "\n\n", $md[ $key ] );
			if ( isset( $parts[1] ) && 0 !== strpos( $parts[1], '#' ) ) {
				return trim( preg_replace( '/\s+/', ' ', $parts[1] ) );
			}
		}
	}
	$name = 'home' === $type ? '' : ai_feature_pages()[ $key ][0];
	$core = 'Personalisation Hub is a self-hosted personalisation platform for businesses with physical locations. It combines live store context (time, weather, stock) with your own customer data and personalises websites, apps and in-store screens in real time. It runs in your own AWS account.';
	return '' === $name ? $core : $name . ' is part of ' . $core;
}

/** Question headings for each fact label. */
function ai_question( $label, $name ) {
	$q = [
		'Best for'    => 'Who is Personalisation Hub for' . ( $name ? ' in ' . $name : '' ) . '?',
		'Industries'  => 'Which industries does Personalisation Hub serve?',
		'Outcomes'    => 'What results does Personalisation Hub help ' . ( $name ? $name . ' businesses ' : 'businesses ' ) . 'improve?',
		'Touchpoints' => 'Which screens and channels can Personalisation Hub personalise?',
		'Data used'   => 'What data does Personalisation Hub use?',
		'Deployment'  => 'Where does Personalisation Hub run?',
		'Devices'     => 'Which devices does Personalisation Hub work with?',
		'Installation time' => 'How long does Personalisation Hub take to install?',
		'Try it'      => 'How can I try Personalisation Hub?',
	];
	return $q[ $label ] ?? $label . '?';
}

function ai_related( $type, $key ) {
	$f   = ai_feature_pages();
	$ind = ai_industry_names();
	$out = [];
	$add = function ( $t, $k, $text ) use ( &$out ) {
		$out[ ai_url( $t, $k ) ] = $text;
	};
	if ( 'industry' === $type ) {
		$keys = array_keys( $ind );
		if ( 'industries' !== $key ) {
			$add( 'industry', 'industries', 'Personalisation Hub by industry' );
			$others = array_values( array_diff( $keys, [ 'industries', $key ] ) );
			$i      = (int) array_search( $key, array_diff( $keys, [ 'industries' ] ), true );
			foreach ( [ $others[ $i % count( $others ) ], $others[ ( $i + 1 ) % count( $others ) ] ] as $k ) {
				$add( 'industry', $k, 'Personalisation Hub for ' . $ind[ $k ] );
			}
		} else {
			foreach ( [ 'convenience', 'grocery', 'banking' ] as $k ) {
				$add( 'industry', $k, 'Personalisation Hub for ' . $ind[ $k ] );
			}
		}
		$add( 'feature', 'digital-signage', 'Digital Signage' );
		$add( 'feature', 'personalisation', 'Personalisation' );
	} elseif ( 'home' === $type ) {
		$add( 'industry', 'industries', 'Personalisation Hub by industry' );
		foreach ( [ 'digital-signage', 'personalisation', 'store-sites', 'retail-queue-management' ] as $k ) {
			$add( 'feature', $k, $f[ $k ][0] );
		}
	} else {
		$add( 'home', '/', 'What is Personalisation Hub?' );
		$add( 'industry', 'industries', 'Personalisation Hub by industry' );
		$all = array_values( array_diff( array_keys( $f ), [ '/', $key ] ) );
		$i   = (int) array_search( $key, array_diff( array_keys( $f ), [ '/' ] ), true );
		foreach ( [ $all[ $i % count( $all ) ], $all[ ( $i + 1 ) % count( $all ) ] ] as $k ) {
			$add( 'feature', $k, $f[ $k ][0] );
		}
	}
	return $out;
}

/** Fallback meta description for a page whose own SEOPress description is empty or duplicated. */
function ai_meta_desc( $type, $key ) {
	if ( 'industry' === $type ) {
		if ( 'industries' === $key ) {
			return 'How Personalisation Hub personalises screens, apps and sites for fuel, hospitality, telco, pharmacy, grocery, fashion, restaurants and banking.';
		}
		$tag = [
			'convenience'  => 'Fuel stops into baskets.', 'hospitality' => 'Higher revenue per head, every session.', 'telco' => 'More walk-ins and post-pay conversions.',
			'pharmacy'     => 'No queues, more walk-ins and sales.', 'retail-media' => 'Every screen, sold as targeted, measurable media.',
			'grocery'      => 'Bigger baskets from every visit.', 'fashion' => 'More browsers become buyers in store.',
			'qsr'          => 'Higher order value from every screen.', 'banking' => 'More home loan applications from branches.',
		][ $key ];
		return $tag . ' Personalisation Hub personalises screens, apps and sites in real time, in your own AWS account.';
	}
	if ( 'home' === $type ) {
		return 'A self-hosted personalisation platform for businesses with physical locations. Personalise websites, apps and in-store screens in real time, in your own AWS account.';
	}
	$p = ai_feature_pages()[ $key ];
	return $p[1] . '. Part of Personalisation Hub, a self-hosted personalisation platform that runs in your own AWS account.';
}

/** True when a page's SEOPress description is empty, or the same as one a page earlier in the order already uses. */
function ai_desc_needs_fallback( $own, array $earlier ) {
	$own = trim( (string) $own );
	return '' === $own || in_array( $own, array_map( 'trim', $earlier ), true );
}

/** Descriptions of the pages ordered before this one (home, features, then industries). */
function ai_earlier_descs( $type, $key ) {
	$order = [];
	foreach ( array_keys( ai_feature_pages() ) as $k ) {
		$order[] = [ '/' === $k ? 'home' : 'feature', $k ];
	}
	foreach ( array_keys( ai_industry_names() ) as $k ) {
		$order[] = [ 'industry', $k ];
	}
	$out = [];
	foreach ( $order as $o ) {
		if ( $o === [ $type, $key ] ) {
			break;
		}
		$id = 'home' === $o[0] ? (int) get_option( 'page_on_front' ) : 0;
		if ( 'feature' === $o[0] ) {
			$pg = get_page_by_path( $o[1] );
			$id = $pg ? $pg->ID : 0;
		} elseif ( 'industry' === $o[0] ) {
			$pg = get_page_by_path( 'industries' === $o[1] ? 'industries' : 'industries/' . $o[1] );
			$id = $pg ? $pg->ID : 0;
		}
		if ( $id ) {
			$out[] = (string) get_post_meta( $id, '_seopress_titles_desc', true );
		}
	}
	return array_filter( $out, 'strlen' );
}

function ai_name( $type, $key ) {
	return 'industry' === $type && 'industries' !== $key ? ai_industry_names()[ $key ] : '';
}

// Titles are never touched. A description is filled only when the page's own is empty or duplicates an earlier page's.
add_filter( 'seopress_titles_desc', function ( $value ) {
	$page = ai_page();
	if ( ! $page ) {
		return $value;
	}
	return ai_desc_needs_fallback( $value, ai_earlier_descs( $page[0], $page[1] ) ) ? ai_meta_desc( $page[0], $page[1] ) : $value;
}, 20 );

add_action( 'wp_head', function () {
	if ( ! ai_page() ) {
		return;
	}
	echo '<style id="ph-ai-hygiene">.ph-ai-lead{max-width:960px;margin:0 auto;padding:16px 20px;font-size:16px;line-height:1.6}.ph-ai-lead p{margin:0}.ph-ai-facts{max-width:960px;margin:0 auto;padding:32px 20px}.ph-ai-facts h2{font-size:28px;line-height:1.25;margin:0 0 16px}.ph-ai-facts h3{font-size:18px;line-height:1.35;margin:20px 0 4px}.ph-ai-facts p{margin:0;line-height:1.6}.ph-ai-facts ul{margin:8px 0 0;padding-left:20px}.ph-ai-facts li{margin:4px 0}.ph-ai-updated{margin-top:24px;font-size:14px;opacity:.75}</style>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput -- static CSS.
}, 25 );

add_filter( 'the_content', function ( $html ) {
	if ( ! in_the_loop() || ! is_main_query() ) {
		return $html;
	}
	$page = ai_page();
	if ( ! $page ) {
		return $html;
	}
	list( $type, $key ) = $page;
	$name  = ai_name( $type, $key );
	/* Summary sits at the top of the Key facts section (it looked out of place above the hero). */
	$lead  = '<p class="ph-ai-summary">' . esc_html( ai_summary( $type, $key ) ) . '</p>';
	$facts = '';
	foreach ( ai_facts( $type, $key ) as $label => $text ) {
		$facts .= '<h3>' . esc_html( ai_question( $label, $name ) ) . '</h3><p>' . esc_html( $text ) . '</p>';
	}
	$links = '';
	foreach ( ai_related( $type, $key ) as $url => $text ) {
		$links .= '<li><a href="' . esc_url( $url ) . '">' . esc_html( $text ) . '</a></li>';
	}
	$post = get_queried_object();
	$mod  = get_post_modified_time( 'c', true, $post );
	$tail = '<section class="ph-ai-facts" aria-label="Key facts"><h2>' . esc_html( $name ? 'What should I know about Personalisation Hub for ' . $name . '?' : 'What should I know about Personalisation Hub?' ) . '</h2>'
		. $lead
		. $facts
		. '<h3>Where can I read more?</h3><ul>' . $links . '</ul>'
		. '<p class="ph-ai-updated">Last updated <time datetime="' . esc_attr( $mod ) . '">' . esc_html( get_the_modified_date( 'j F Y', $post ) ) . '</time></p></section>';
	return $html . $tail;
}, 20 );
