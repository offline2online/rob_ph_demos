<?php
/**
 * Run Your Own RMN page (13 Nov 2026; renamed 14 Nov 2026): personalisationhub.com/run-your-own-rmn/, "Run Your Own RMN" (run your own
 * retail media network), built from the approved design and HIDDEN until launch. The offer is "network operator" and its leads are
 * "Network operator inquiry". The retired offer name appears nowhere: not in what a visitor sees, and not in a file, function,
 * constant, option, route, key, class, comment or test. Neither does the page's previous name.
 *
 * While OPERATOR_LIVE is false the page is published but linked from nowhere and not indexed: noindex (wp_robots, SEOPress's own
 * robots meta and X-Robots-Tag), left out of the WordPress and SEOPress sitemaps, and absent from llms.txt, the markdown twin, the
 * agent endpoint and the robots.txt allow group. The header gets a top-level "Run Your Own RMN" item only on the page itself.
 * Launching is one change: OPERATOR_LIVE = true (the item then shows on every page, the noindex is lifted, and llms.txt, the twin
 * at ?format=md, the agent endpoint and robots.txt name the page).
 *
 * - The page: page 10776 on the live site (OPERATOR_PAGE_ID). operator_ensure_page() keeps it on slug `run-your-own-rmn`, title
 *   "Run Your Own RMN", content [ph_operator], its _wp_old_slug meta removed (so every earlier URL is a 404), id stored in
 *   ph_operator_page. Moving an existing page happens once, behind its own add_option lock (ph_operator_rmn_move_lock). A site
 *   without that page gets it created (template elementor_header_footer: the site header and footer, no title bar). Never two.
 * - [ph_operator] renders the whole page server side (operator-content.php). operator.css / operator.js load on that page only.
 * - SEO on the page (operator_head_html): the title, meta description, canonical, Open Graph, Twitter card and one JSON-LD @graph
 *   (WebPage, Service, BreadcrumbList, FAQPage from the visible FAQ). SEOPress's and WordPress's own copies are switched off there.
 * - POST ph-site/v1/operator-lead: the product tour gate's lead. One ph_lead per person (lead_find_existing / lead_add_activity),
 *   fires ph_lead_captured so leads.php forwards it to the console as a "Network operator inquiry" (leadType "operator").
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const OPERATOR_LIVE          = false;
const OPERATOR_SLUG          = 'run-your-own-rmn';
const OPERATOR_PATH          = '/run-your-own-rmn/';
const OPERATOR_TITLE         = 'Run Your Own RMN';
const OPERATOR_DOC_TITLE     = 'Run Your Own Retail Media Network (RMN) - Personalisation Hub';
/** The page's public address (canonical, og:url, JSON-LD, llms.txt and the twin). */
const OPERATOR_URL           = 'https://personalisationhub.com/run-your-own-rmn/';
const OPERATOR_SITE          = 'https://personalisationhub.com';
const OPERATOR_META_DESC     = 'Run your own retail media network (RMN) on a white-label platform with real-time in-store personalisation. Estimate your earnings and take the tour.';
const OPERATOR_OG_TITLE      = 'Run Your Own Retail Media Network (RMN)';
/** Used for og:image only when neither the home page nor SEOPress names a social image: the home hero, which shows content. */
const OPERATOR_OG_FALLBACK   = 'https://personalisationhub.com/wp-content/uploads/2026/11/home-hero-bg.webp';
const OPERATOR_LLMS_SUMMARY  = 'run your own retail media network on a white-label platform with real-time in-store personalisation, in your own AWS account; estimate your earnings with the calculator and take the interactive product tour.';
const OPERATOR_PAGE_ID       = 10776;
const OPERATOR_SHORTCODE     = 'ph_operator';
const OPERATOR_TEMPLATE      = 'elementor_header_footer';
const OPERATOR_PAGE_OPTION   = 'ph_operator_page';
const OPERATOR_LOCK_OPTION   = 'ph_operator_page_lock';
/** The move of an existing page onto OPERATOR_SLUG (14 Nov 2026): its own lock, apart from the 1.9.21 one. */
const OPERATOR_MOVE_LOCK     = 'ph_operator_rmn_move_lock';
const OPERATOR_STATE_OPTION  = 'ph_operator_state';
/** Internal key (ph_lead_source, industry, lead_type / leadType): the console routes network operator leads on it. */
const OPERATOR_SOURCE        = 'operator';
const OPERATOR_LABEL         = 'Network operator inquiry';
const OPERATOR_DETAIL        = 'Run Your Own RMN page – product tour';
const OPERATOR_BACKGROUNDS   = array( 'Agency media or account management', 'Ad-tech sales or partnerships', 'Retail media', 'Marketing', 'Something else' );
const OPERATOR_TOUR_PATH     = '/industries/retail-media/tour/';
/** Calculator share of ad revenue. Code only: never printed on the page, in a tooltip, the twin or anything an agent reads. */
const OPERATOR_INCOME_SHARE  = 0.5;

require_once __DIR__ . '/operator-content.php';

/* ---------- Calculator (mirrors operator.js) ---------- */

function operator_defaults() {
	return array( 'ven' => 90, 'dis' => 3, 'vis' => 800, 'cpm' => 25, 'atv' => 25, 'view' => 60, 'up' => 15 );
}

function operator_calc( array $s ) {
	$s              = array_merge( operator_defaults(), $s );
	$visitors_month = $s['ven'] * $s['vis'] * 365 / 12;
	$viewers        = $visitors_month * $s['view'] / 100;
	$views_month    = $viewers * $s['dis'];
	$ad_revenue     = $views_month * 12 / 1000 * $s['cpm'];
	return array(
		'venues'        => $s['ven'],
		'displays'      => $s['ven'] * $s['dis'],
		'visitorsMonth' => $visitors_month,
		'viewsMonth'    => $views_month,
		'income'        => $ad_revenue * OPERATOR_INCOME_SHARE,
		'extraSales'    => $viewers * 12 * $s['atv'] * $s['up'] / 100,
	);
}

function operator_money( $n ) {
	if ( $n >= 1e6 ) {
		return '$' . number_format( $n / 1e6, 1, '.', '' ) . 'M';
	}
	if ( $n >= 1e3 ) {
		return '$' . round( $n / 1e3 ) . 'K';
	}
	return '$' . round( $n );
}

function operator_count( $n ) {
	return number_format( (float) $n, ( floor( $n ) == $n ) ? 0 : 1, '.', ',' ); // phpcs:ignore WordPress.PHP.StrictComparisons
}

function operator_view( array $c ) {
	return array(
		'yours'      => operator_money( $c['income'] ),
		'venues'     => operator_count( $c['venues'] ),
		'displays'   => operator_count( $c['displays'] ),
		'visitors'   => operator_count( round( $c['visitorsMonth'] ) ),
		'views'      => operator_count( round( $c['viewsMonth'] ) ),
		'extraSales' => operator_money( $c['extraSales'] ),
	);
}

/* ---------- The page ---------- */

function operator_is_live() {
	return (bool) apply_filters( 'ph_operator_live', OPERATOR_LIVE );
}

/** True on the /run-your-own-rmn/ page itself (a top-level page with that slug). */
function operator_is_page() {
	if ( ! function_exists( 'is_page' ) || ! is_page() ) {
		return false;
	}
	$post = get_queried_object();
	return $post instanceof \WP_Post && OPERATOR_SLUG === $post->post_name && 0 === (int) $post->post_parent;
}

/** True when $post is the finished page: a published top-level page on the Run Your Own RMN slug. */
function operator_page_ready( $post ) {
	return $post instanceof \WP_Post && 'page' === $post->post_type && 'publish' === $post->post_status
		&& OPERATOR_SLUG === $post->post_name && 0 === (int) $post->post_parent;
}

/** True when $p is one of our shortcode pages ([ph_...] content): the only kind of existing page the move may take. */
function operator_is_ours( $p ) {
	return $p instanceof \WP_Post && 'page' === $p->post_type && 'trash' !== $p->post_status && 0 === strpos( ltrim( (string) $p->post_content ), '[ph_' );
}

/**
 * Makes sure the published page `run-your-own-rmn` exists. Runs on init. Once ph_operator_page names a finished page it returns
 * 'exists' at once (idempotent). Otherwise:
 * - an existing page is MOVED: the stored page or page OPERATOR_PAGE_ID (10776, found by id), each only while its content is one of
 *   our [ph_...] shortcodes, else a top-level page already on the slug. It gets post_name run-your-own-rmn, post_title
 *   "Run Your Own RMN", post_content [ph_operator], is published, and every _wp_old_slug meta is deleted, so the slugs it had before
 *   (the 1.9.21 one and the one before that) answer 404. The move happens once, behind its own add_option lock (OPERATOR_MOVE_LOCK).
 * - only when there is no page at all is it created, behind OPERATOR_LOCK_OPTION. It never makes a second page.
 * Both locks are atomic (two requests can never both act); one left by a request that died is released after 10 minutes.
 * Returns 'exists' | 'migrated' | 'created' | 'locked' | 'failed' (an update WordPress refused: retried on the next request).
 */
function operator_ensure_page() {
	$id   = (int) get_option( OPERATOR_PAGE_OPTION, 0 );
	$post = $id ? get_post( $id ) : null;
	if ( operator_page_ready( $post ) ) {
		return 'exists';
	}
	$found = null;
	foreach ( array( $post, get_post( OPERATOR_PAGE_ID ) ) as $p ) {
		if ( operator_is_ours( $p ) ) {
			$found = $p;
			break;
		}
	}
	if ( ! $found ) {
		$p = get_page_by_path( OPERATOR_SLUG, OBJECT, 'page' );
		if ( $p && 0 === (int) $p->post_parent && 'trash' !== $p->post_status ) {
			$found = $p;
		}
	}
	return $found ? operator_move_page( $found ) : operator_create_page();
}

/** Takes an atomic add_option lock; a lock older than 10 minutes (a request that died) is released for the next request. */
function operator_lock( $name ) {
	if ( add_option( $name, (string) time(), '', 'no' ) ) {
		return true;
	}
	$at = (int) get_option( $name, 0 );
	if ( $at && $at < time() - 600 ) {
		delete_option( $name );
	}
	return false;
}

/** Moves an existing page onto the slug, title and shortcode, once, behind OPERATOR_MOVE_LOCK. */
function operator_move_page( \WP_Post $found ) {
	if ( ! operator_lock( OPERATOR_MOVE_LOCK ) ) {
		return 'locked';
	}
	$id  = (int) $found->ID;
	$res = wp_update_post( array(
		'ID'           => $id,
		'post_name'    => OPERATOR_SLUG,
		'post_title'   => OPERATOR_TITLE,
		'post_content' => '[' . OPERATOR_SHORTCODE . ']',
		'post_status'  => 'publish',
		'post_parent'  => 0,
	), true );
	if ( ! $res || is_wp_error( $res ) ) {
		delete_option( OPERATOR_MOVE_LOCK );
		return 'failed';
	}
	delete_post_meta( $id, '_wp_old_slug' ); // every earlier slug, including the one wp_update_post just recorded: they answer 404.
	update_option( OPERATOR_PAGE_OPTION, $id, true );
	delete_option( OPERATOR_MOVE_LOCK );
	return 'migrated';
}

/** Creates the page (a site without one), behind OPERATOR_LOCK_OPTION. */
function operator_create_page() {
	if ( ! operator_lock( OPERATOR_LOCK_OPTION ) ) {
		return 'locked';
	}
	$id = wp_insert_post( array(
		'post_type'      => 'page',
		'post_status'    => 'publish',
		'post_title'     => OPERATOR_TITLE,
		'post_name'      => OPERATOR_SLUG,
		'post_content'   => '[' . OPERATOR_SHORTCODE . ']',
		'post_parent'    => 0,
		'comment_status' => 'closed',
		'ping_status'    => 'closed',
		'meta_input'     => array( '_wp_page_template' => OPERATOR_TEMPLATE ),
	) );
	$id = is_wp_error( $id ) ? 0 : (int) $id;
	if ( $id ) {
		update_option( OPERATOR_PAGE_OPTION, $id, true );
	}
	delete_option( OPERATOR_LOCK_OPTION );
	return $id ? 'created' : 'failed';
}

function operator_page_id() {
	return (int) get_option( OPERATOR_PAGE_OPTION, 0 );
}

/**
 * Keeps SEOPress's own per-page noindex (`_seopress_robots_index` = yes, which also drops the page from its XML sitemap and is what the
 * agent endpoint reads) in step with OPERATOR_LIVE. Runs only when the state changes (OPERATOR_STATE_OPTION).
 */
function operator_sync_state() {
	$id = operator_page_id();
	if ( ! $id ) {
		return;
	}
	$want = operator_is_live() ? 'live' : 'hidden';
	if ( get_option( OPERATOR_STATE_OPTION ) === $want . ':' . $id ) {
		return;
	}
	if ( 'hidden' === $want ) {
		update_post_meta( $id, '_seopress_robots_index', 'yes' );
	} else {
		delete_post_meta( $id, '_seopress_robots_index' );
	}
	update_option( OPERATOR_STATE_OPTION, $want . ':' . $id, true );
}

function operator_init() {
	if ( ( defined( 'WP_CLI' ) && WP_CLI ) || ( function_exists( 'wp_doing_cron' ) && wp_doing_cron() ) ) {
		return;
	}
	operator_ensure_page();
	operator_sync_state();
}

/** wp_robots: noindex on the page while it is not live. */
function operator_robots( array $robots ) {
	if ( operator_is_page() && ! operator_is_live() ) {
		unset( $robots['index'] );
		$robots['noindex'] = true;
	}
	return $robots;
}

/** The browser and SEOPress title on the page: "Run Your Own Retail Media Network (RMN) - Personalisation Hub". Other pages are untouched. */
function operator_document_title( $title ) {
	return operator_is_page() ? OPERATOR_DOC_TITLE : $title;
}

/** Sitemap query args (WordPress core and SEOPress): leave the page out while it is not live. */
function operator_sitemap_args( $args ) {
	$id = operator_page_id();
	if ( ! is_array( $args ) || ! $id || operator_is_live() ) {
		return $args;
	}
	$not                 = isset( $args['post__not_in'] ) ? (array) $args['post__not_in'] : array();
	$not[]               = $id;
	$args['post__not_in'] = array_values( array_unique( array_map( 'intval', $not ) ) );
	return $args;
}

/* ---------- Header menu ---------- */

/** A top-level "Run Your Own RMN" menu item for /run-your-own-rmn/ (an object shaped like wp_setup_nav_menu_item's). */
function operator_menu_item( $current, $order ) {
	$id   = operator_page_id();
	$item = (object) array(
		'ID'                    => -91063,
		'db_id'                 => -91063,
		'menu_item_parent'      => '0',
		'object_id'             => (string) $id,
		'object'                => 'page',
		'type'                  => 'post_type',
		'type_label'            => 'Page',
		'post_type'             => 'nav_menu_item',
		'post_status'           => 'publish',
		'post_parent'           => 0,
		'title'                 => OPERATOR_TITLE,
		'url'                   => home_url( OPERATOR_PATH ),
		'target'                => '',
		'attr_title'            => '',
		'description'           => '',
		'classes'               => array( 'menu-item', 'menu-item-type-post_type', 'menu-item-object-page', 'ph-rmn-item' ),
		'xfn'                   => '',
		'menu_order'            => $order,
		'current'               => (bool) $current,
		'current_item_ancestor' => false,
		'current_item_parent'   => false,
	);
	if ( $current ) {
		$item->classes[] = 'current-menu-item';
		$item->classes[] = 'current_page_item';
	}
	return $item;
}

function operator_title_is( $item, array $names ) {
	$t = strtolower( trim( wp_strip_all_tags( (string) ( isset( $item->title ) ? $item->title : '' ) ) ) );
	return in_array( $t, $names, true );
}

/**
 * wp_nav_menu_objects: adds "Run Your Own RMN" to the header's main menu (the one whose top level has Industry and Support; the
 * ElementsKit widget in header 2330) between Industry and Support. Hidden build: only on /run-your-own-rmn/. Live: on every page. Any
 * other menu (the footer) is untouched, and a menu that already links to /run-your-own-rmn/ is left alone. Pure of globals apart from
 * the arguments.
 */
function operator_menu_objects( $items, $on_page, $live ) {
	if ( ! is_array( $items ) || ( ! $on_page && ! $live ) ) {
		return $items;
	}
	$industry = -1;
	$support  = -1;
	foreach ( array_values( $items ) as $i => $it ) {
		if ( ! is_object( $it ) ) {
			continue;
		}
		if ( isset( $it->url ) && false !== strpos( (string) $it->url, OPERATOR_PATH ) && 0 === (int) $it->menu_item_parent ) {
			return $items;
		}
		if ( 0 !== (int) $it->menu_item_parent ) {
			continue;
		}
		if ( operator_title_is( $it, array( 'industry', 'industries' ) ) ) {
			$industry = $i;
		} elseif ( operator_title_is( $it, array( 'support', 'support centre' ) ) ) {
			$support = $i;
		}
	}
	if ( $industry < 0 || $support < 0 || $support < $industry ) {
		return $items;
	}
	$items = array_values( $items );
	if ( $on_page ) { // this page is Run Your Own RMN, not whatever else the menu marked current.
		foreach ( $items as $it ) {
			if ( is_object( $it ) && ! empty( $it->current ) ) {
				$it->current = false;
				$it->classes = array_values( array_diff( (array) $it->classes, array( 'current-menu-item', 'current_page_item' ) ) );
			}
		}
	}
	array_splice( $items, $support, 0, array( operator_menu_item( $on_page, 0 ) ) );
	foreach ( $items as $n => $it ) {
		if ( is_object( $it ) ) {
			$it->menu_order = $n + 1;
		}
	}
	return $items;
}

/** aria-current="page" on the Run Your Own RMN link while it is the current page. */
function operator_menu_link_atts( $atts, $item ) {
	if ( is_object( $item ) && -91063 === (int) $item->ID && ! empty( $item->current ) ) {
		$atts['aria-current'] = 'page';
	}
	return $atts;
}

/* ---------- SEO, the markdown twin and agents ---------- */

/**
 * The social image: the site's own (the home page's SEOPress Facebook image, else SEOPress's default social image), else the home
 * hero (OPERATOR_OG_FALLBACK). Never the logo: it must show content. alt from the attachment when WordPress knows it.
 */
function operator_og_image() {
	$url   = '';
	$front = (int) get_option( 'page_on_front', 0 );
	if ( $front && function_exists( 'get_post_meta' ) ) {
		$url = trim( (string) get_post_meta( $front, '_seopress_social_fb_img', true ) );
	}
	if ( '' === $url ) {
		$o   = get_option( 'seopress_social_option_name' );
		$url = is_array( $o ) && ! empty( $o['seopress_social_facebook_img'] ) && is_string( $o['seopress_social_facebook_img'] ) ? trim( $o['seopress_social_facebook_img'] ) : '';
	}
	if ( '' === $url || ! preg_match( '#^https://#i', $url ) ) {
		$url = OPERATOR_OG_FALLBACK;
	}
	$alt = '';
	if ( function_exists( 'attachment_url_to_postid' ) ) {
		$aid = (int) attachment_url_to_postid( $url );
		$alt = $aid ? trim( (string) get_post_meta( $aid, '_wp_attachment_image_alt', true ) ) : '';
	}
	if ( '' === $alt ) {
		$alt = 'Personalisation Hub: screens that adapt in real time to the person in front of them';
	}
	return (array) apply_filters( 'ph_operator_og_image', array( 'url' => $url, 'alt' => $alt ) );
}

/** The page's JSON-LD: one @graph of WebPage, Service, BreadcrumbList and FAQPage (the visible FAQ, word for word). */
function operator_graph() {
	$site = OPERATOR_SITE;
	$faq  = array();
	foreach ( operator_faq() as $qa ) {
		$faq[] = array( '@type' => 'Question', 'name' => $qa[0], 'acceptedAnswer' => array( '@type' => 'Answer', 'text' => $qa[1] ) );
	}
	return array(
		'@context' => 'https://schema.org',
		'@graph'   => array(
			array( '@type' => 'Organization', '@id' => $site . '/#organization', 'name' => 'Personalisation Hub', 'url' => $site . '/' ),
			array( '@type' => 'WebSite', '@id' => $site . '/#website', 'url' => $site . '/', 'name' => 'Personalisation Hub', 'inLanguage' => 'en-GB', 'publisher' => array( '@id' => $site . '/#organization' ) ),
			array(
				'@type'       => 'WebPage',
				'@id'         => OPERATOR_URL . '#webpage',
				'url'         => OPERATOR_URL,
				'name'        => OPERATOR_OG_TITLE,
				'description' => OPERATOR_META_DESC,
				'inLanguage'  => 'en-GB',
				'isPartOf'    => array( '@id' => $site . '/#website' ),
				'about'       => array( '@type' => 'Thing', 'name' => 'Retail media network' ),
				'breadcrumb'  => array( '@id' => OPERATOR_URL . '#breadcrumb' ),
				'mainEntity'  => array( '@id' => OPERATOR_URL . '#service' ),
			),
			array(
				'@type'       => 'Service',
				'@id'         => OPERATOR_URL . '#service',
				'name'        => 'Run your own retail media network',
				'serviceType' => 'White-label retail media network platform',
				'description' => OPERATOR_META_DESC,
				'url'         => OPERATOR_URL,
				'provider'    => array( '@id' => $site . '/#organization' ),
			),
			array(
				'@type'           => 'BreadcrumbList',
				'@id'             => OPERATOR_URL . '#breadcrumb',
				'itemListElement' => array(
					array( '@type' => 'ListItem', 'position' => 1, 'name' => 'Home', 'item' => $site . '/' ),
					array( '@type' => 'ListItem', 'position' => 2, 'name' => OPERATOR_TITLE, 'item' => OPERATOR_URL ),
				),
			),
			array( '@type' => 'FAQPage', '@id' => OPERATOR_URL . '#faq', 'url' => OPERATOR_URL, 'inLanguage' => 'en-GB', 'isPartOf' => array( '@id' => OPERATOR_URL . '#webpage' ), 'mainEntity' => $faq ),
		),
	);
}

/** JSON for an inline script tag: no raw "</" or "&", so content can never end the tag. */
function operator_json_ld( array $graph ) {
	$j = json_encode( $graph, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP );
	return false === $j ? '' : $j;
}

/**
 * Everything the page puts in <head> for search engines, AI search and link previews: meta description, canonical, Open Graph,
 * Twitter card and the JSON-LD (and, once live, the twin's alternate link). Harmless while hidden: the page is noindex.
 */
function operator_head_html( array $img, $live ) {
	$a = function ( $v ) {
		return esc_attr( $v );
	};
	$h  = '<meta name="description" content="' . $a( OPERATOR_META_DESC ) . '">' . "\n";
	$h .= '<link rel="canonical" href="' . $a( OPERATOR_URL ) . '">' . "\n";
	$h .= '<meta property="og:type" content="website">' . "\n";
	$h .= '<meta property="og:site_name" content="Personalisation Hub">' . "\n";
	$h .= '<meta property="og:locale" content="en_GB">' . "\n";
	$h .= '<meta property="og:title" content="' . $a( OPERATOR_OG_TITLE ) . '">' . "\n";
	$h .= '<meta property="og:description" content="' . $a( OPERATOR_META_DESC ) . '">' . "\n";
	$h .= '<meta property="og:url" content="' . $a( OPERATOR_URL ) . '">' . "\n";
	$h .= '<meta property="og:image" content="' . $a( $img['url'] ) . '">' . "\n";
	$h .= '<meta property="og:image:alt" content="' . $a( $img['alt'] ) . '">' . "\n";
	$h .= '<meta name="twitter:card" content="summary_large_image">' . "\n";
	$h .= '<meta name="twitter:title" content="' . $a( OPERATOR_OG_TITLE ) . '">' . "\n";
	$h .= '<meta name="twitter:description" content="' . $a( OPERATOR_META_DESC ) . '">' . "\n";
	$h .= '<meta name="twitter:image" content="' . $a( $img['url'] ) . '">' . "\n";
	$h .= '<meta name="twitter:image:alt" content="' . $a( $img['alt'] ) . '">' . "\n";
	if ( $live ) {
		$h .= '<link rel="alternate" type="text/markdown" href="' . $a( OPERATOR_URL . '?format=md' ) . '">' . "\n";
	}
	return $h . '<script type="application/ld+json">' . operator_json_ld( operator_graph() ) . '</script>' . "\n";
}

/**
 * The markdown twin (?format=md), built from the page's own lists in operator-content.php, so it can never drift from the page.
 * The calculator is described by its inputs, outputs, the defaults' figures and the page's own "How it's calculated" text;
 * the share constant is never in it.
 */
function operator_twin() {
	$d   = operator_defaults();
	$out = operator_view( operator_calc( $d ) );
	$md  = '# ' . OPERATOR_H1 . "\n\n> " . OPERATOR_META_DESC . "\n\nSource: " . OPERATOR_URL . "\n\n"
		. '**' . OPERATOR_SUBLINE . ".**\n\n" . OPERATOR_HERO_P . "\n\n## Key facts\n\n";
	foreach ( operator_why_items() as $w ) {
		$md .= '- **' . $w[1] . ':** ' . $w[2] . "\n";
	}
	$md .= '- **Venues:** any business with a physical presence, with or without screens today, e.g. ' . strtolower( implode( ', ', OPERATOR_VENUE_TYPES ) ) . ".\n"
		. "- **Who it suits:** people who know media and use AI tools every day: agency media and account leads, ad-tech sales and partnerships, and retail media specialists.\n\n## How it works\n\n";
	foreach ( operator_steps() as $st ) {
		$md .= $st[0] . '. **' . $st[1] . ':** ' . $st[2] . "\n";
	}
	$md .= "\n## Benefits calculator\n\nThe page's benefits calculator (\"What could it be worth to you?\") estimates what your network could earn. Change any input and the figures update.\n\nInputs (default in brackets):\n\n";
	foreach ( operator_calc_fields() as $k => $f ) {
		$v   = 'range' === $f['type'] ? $d[ $k ] . '%' : ( '' !== $f['prefix'] ? $f['prefix'] : '' ) . $d[ $k ];
		$md .= '- ' . $f['label'] . ' (' . $v . '): ' . $f['tip'] . "\n";
	}
	$md .= "\nWith the defaults the page shows:\n\n";
	foreach ( operator_calc_outputs() as $k => $label ) {
		$md .= '- ' . $label . ': ' . $out[ $k ] . "\n";
	}
	$md .= "\nHow it's calculated: " . OPERATOR_HOW_CALC . "\n\nOn the page, a browser agent can run the calculator with the WebMCP tool `estimate_rmn_earnings`.\n\n## FAQ\n\n";
	foreach ( operator_faq() as $qa ) {
		$md .= '### ' . $qa[0] . "\n\n" . $qa[1] . "\n\n";
	}
	$md .= "## Interactive product tour\n\n" . OPERATOR_TOUR_H . ': ' . OPERATOR_TOUR_P . ' Unlock it on the page (' . OPERATOR_URL . '#tour) with your full name, email, where you plan to operate, your background and your agreement to be contacted; our team will also follow up with more on becoming a network operator.' . "\n";
	return $md;
}

/** llms.txt: a "## Run your own RMN" section with the page's twin, only once the page is live. Placed before "## Pricing and trial". */
function operator_llms_filter( $text, $live ) {
	$text = (string) $text;
	if ( ! $live || false !== strpos( $text, '## Run your own RMN' ) ) {
		return $text;
	}
	$sec = "## Run your own RMN\n\n- [Run your own retail media network (RMN)](" . OPERATOR_URL . '?format=md): ' . OPERATOR_LLMS_SUMMARY . " On the page, browser agents can run its earnings calculator with the WebMCP tool estimate_rmn_earnings.\n\n";
	$at  = strpos( $text, '## Pricing and trial' );
	return false === $at ? rtrim( $text ) . "\n\n" . rtrim( $sec ) . "\n" : substr( $text, 0, $at ) . $sec . substr( $text, $at );
}

/**
 * The page as the agent endpoint (ph-agent-endpoint, describe_platform and /llms-full.txt) sees it, through the ph_agent_extra_pages
 * filter: null until the page is live and exists.
 */
function operator_agent_page( $live ) {
	if ( ! $live || ! operator_page_id() ) {
		return null;
	}
	return array( 'title' => 'Run your own retail media network (RMN)', 'url' => OPERATOR_URL, 'summary' => ucfirst( OPERATOR_LLMS_SUMMARY ), 'md' => operator_twin() );
}

/** robots.txt: the page's path in the AI agents' allow group (ai-surface.php, ph_ai_robots_allow), only once live. */
function operator_robots_allow( $paths, $live ) {
	$paths = is_array( $paths ) ? $paths : array();
	if ( $live && ! in_array( OPERATOR_PATH, $paths, true ) ) {
		$paths[] = OPERATOR_PATH;
	}
	return $paths;
}

/** SEOPress's own description, canonical, Open Graph and Twitter tags: off on this page, where operator_head_html() prints them. */
function operator_seopress_off( $v ) {
	return operator_is_page() ? '' : $v;
}

/* ---------- Network operator lead ---------- */

/** LinkedIn is optional. Returns array( ok, normalised ): https:// added when missing; the host must be linkedin.com or a subdomain. */
function operator_linkedin( $v ) {
	$v = trim( (string) $v );
	if ( '' === $v ) {
		return array( true, '' );
	}
	if ( strlen( $v ) > 300 || preg_match( '/\s/', $v ) ) {
		return array( false, '' );
	}
	if ( ! preg_match( '#^[a-z][a-z0-9+.-]*://#i', $v ) ) {
		$v = 'https://' . ltrim( $v, '/' );
	}
	$p    = parse_url( $v ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	$host = is_array( $p ) && isset( $p['host'] ) ? strtolower( $p['host'] ) : '';
	$sch  = is_array( $p ) && isset( $p['scheme'] ) ? strtolower( $p['scheme'] ) : '';
	if ( ! in_array( $sch, array( 'http', 'https' ), true ) || ( 'linkedin.com' !== $host && ! preg_match( '/\.linkedin\.com$/', $host ) ) ) {
		return array( false, '' );
	}
	$v = 'https://' . substr( $v, strlen( $sch ) + 3 );
	return array( true, strlen( $v ) > 300 ? '' : $v );
}

/** Validates and stores a network operator lead. Returns array( status, body ). Pure of HTTP, so it is unit-tested. */
function operator_handle( array $b ) {
	if ( ! empty( $b['website'] ) ) { // honeypot: pretend success.
		return array( 200, array( 'ok' => true ) );
	}
	if ( lead_throttled() ) {
		return array( 429, array( 'error' => 'Too many requests. Try again later.' ) );
	}
	$str  = function ( $k ) use ( $b ) {
		return isset( $b[ $k ] ) && is_string( $b[ $k ] ) ? trim( sanitize_text_field( $b[ $k ] ) ) : '';
	};
	$lead = array( 'name' => $str( 'name' ) );
	if ( '' === $lead['name'] || strlen( $lead['name'] ) > 120 ) {
		return array( 400, array( 'error' => 'Please enter your full name.', 'field' => 'name' ) );
	}
	$lead['email'] = isset( $b['email'] ) && is_string( $b['email'] ) ? sanitize_email( $b['email'] ) : '';
	if ( ! is_email( $lead['email'] ) || strlen( $lead['email'] ) > 120 ) {
		return array( 400, array( 'error' => 'Please enter a valid email address.', 'field' => 'email' ) );
	}
	list( $ok, $li ) = operator_linkedin( isset( $b['linkedin'] ) && is_string( $b['linkedin'] ) ? $b['linkedin'] : '' );
	if ( ! $ok ) {
		return array( 400, array( 'error' => 'Please enter a LinkedIn profile address, or leave it blank.', 'field' => 'linkedin' ) );
	}
	$lead['linkedin'] = $li;
	$lead['region']   = $str( 'region' );
	if ( '' === $lead['region'] || strlen( $lead['region'] ) > 120 ) {
		return array( 400, array( 'error' => 'Please tell us where you plan to operate.', 'field' => 'region' ) );
	}
	$lead['background'] = $str( 'background' );
	if ( ! in_array( $lead['background'], OPERATOR_BACKGROUNDS, true ) ) {
		return array( 400, array( 'error' => 'Please choose your background.', 'field' => 'background' ) );
	}
	if ( empty( $b['consent'] ) ) {
		return array( 400, array( 'error' => 'Please tick the box to continue.', 'field' => 'consent' ) );
	}
	$test = lead_is_test( isset( $b['test'] ) ? $b['test'] : false );
	$id   = lead_find_existing( $lead['email'], $test );
	if ( $id ) { // already a lead (an industry tour or download): record the network operator inquiry as activity, not a second lead.
		lead_add_activity( $id, OPERATOR_LABEL, OPERATOR_DETAIL );
		foreach ( array( 'linkedin', 'region', 'background' ) as $k ) {
			if ( '' !== $lead[ $k ] && ! get_post_meta( $id, 'ph_lead_' . $k, true ) ) {
				update_post_meta( $id, 'ph_lead_' . $k, $lead[ $k ] );
			}
		}
	} else {
		$id = wp_insert_post( array( 'post_type' => 'ph_lead', 'post_status' => 'private', 'post_title' => $lead['name'] . ' / ' . OPERATOR_LABEL ) );
		if ( $id && ! is_wp_error( $id ) ) {
			foreach ( $lead as $k => $v ) {
				update_post_meta( $id, 'ph_lead_' . $k, $v );
			}
			update_post_meta( $id, 'ph_lead_source', OPERATOR_SOURCE );
			update_post_meta( $id, 'ph_lead_source_label', OPERATOR_LABEL );
			update_post_meta( $id, 'ph_lead_consent', 1 );
			update_post_meta( $id, 'ph_lead_page', OPERATOR_PATH );
			if ( $test ) {
				update_post_meta( $id, 'ph_lead_test', '1' );
			}
			lead_add_activity( $id, OPERATOR_LABEL, OPERATOR_DETAIL );
		} else {
			$id = 0;
		}
	}
	do_action( 'ph_lead_captured', array(
		'company'          => $lead['name'], // kept for the console's ingest; leadType "operator" marks it as an individual, so it is ignored.
		'company_industry' => OPERATOR_LABEL,
		'industry'         => OPERATOR_SOURCE,
		'contact_name'     => $lead['name'],
		'name'             => $lead['name'],
		'email'            => $lead['email'],
		'linkedin'         => $lead['linkedin'],
		'countries'        => $lead['region'],
		'job_title'        => $lead['background'],
		'region'           => $lead['region'],
		'background'       => $lead['background'],
		'lead_type'        => OPERATOR_SOURCE,
		'source'           => OPERATOR_SOURCE,
		'source_label'     => OPERATOR_LABEL,
		'source_detail'    => OPERATOR_DETAIL,
		'consent'          => true,
		'page'             => OPERATOR_PATH,
		'test'             => $test,
		'post_id'          => (int) $id,
	) );
	if ( ! $test ) {
		wp_mail( get_option( 'admin_email' ), 'New network operator inquiry: ' . $lead['name'], "Name: {$lead['name']}\nEmail: {$lead['email']}\nLinkedIn: {$lead['linkedin']}\nWhere they plan to operate: {$lead['region']}\nBackground: {$lead['background']}\nPage: " . OPERATOR_PATH );
	}
	return array( 200, array( 'ok' => true ) );
}

/* ---------- Hooks ---------- */

if ( function_exists( 'add_action' ) && ! defined( 'PH_OPERATOR_TEST' ) ) {
	add_action( 'init', __NAMESPACE__ . '\\operator_init', 25 );

	add_shortcode( OPERATOR_SHORTCODE, function () {
		return operator_html();
	} );

	add_action( 'wp_enqueue_scripts', function () {
		if ( ! operator_is_page() ) {
			return;
		}
		$ver = PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063;
		wp_enqueue_style( 'ph-operator-10063', angie_cs_get_snippet_asset_url( __FILE__, 'operator.css' ), array(), $ver );
		wp_enqueue_script( 'ph-operator-10063', angie_cs_get_snippet_asset_url( __FILE__, 'operator.js' ), array(), $ver, true );
		wp_add_inline_script( 'ph-operator-10063', 'window.PH_OPERATOR = ' . wp_json_encode( array( 'endpoint' => '/wp-json/ph-site/v1/operator-lead', 'tour' => OPERATOR_TOUR_PATH ) ) . ';', 'before' );
	} );

	add_filter( 'wp_robots', __NAMESPACE__ . '\\operator_robots', 999 );
	add_action( 'wp_head', function () {
		if ( operator_is_page() ) {
			echo operator_head_html( operator_og_image(), operator_is_live() ); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped in operator_head_html().
		}
	}, 1 );
	foreach ( array( 'seopress_titles_desc', 'seopress_titles_canonical', 'seopress_social_og_title', 'seopress_social_og_desc', 'seopress_social_og_url', 'seopress_social_og_thumb', 'seopress_social_og_type', 'seopress_social_twitter_card_summary', 'seopress_social_twitter_card_title', 'seopress_social_twitter_card_desc', 'seopress_social_twitter_card_thumb' ) as $hook ) {
		add_filter( $hook, __NAMESPACE__ . '\\operator_seopress_off', 999 );
	}
	add_filter( 'ph_llms_txt', function ( $text ) {
		return operator_llms_filter( $text, operator_is_live() );
	}, 27 );
	add_filter( 'ph_agent_extra_pages', function ( $pages ) {
		$p = operator_agent_page( operator_is_live() );
		return $p ? array_merge( (array) $pages, array( $p ) ) : $pages;
	} );
	add_filter( 'ph_ai_robots_allow', function ( $paths ) {
		return operator_robots_allow( $paths, operator_is_live() );
	} );
	// The twin, only once live (hidden: ?format=md is the ordinary noindex page). Before main.php's industry twin (also priority 0).
	add_action( 'template_redirect', function () {
		if ( ! isset( $_GET['format'] ) || 'md' !== sanitize_key( wp_unslash( $_GET['format'] ) ) || ! operator_is_page() || ! operator_is_live() ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}
		status_header( 200 );
		header( 'Content-Type: text/markdown; charset=utf-8' );
		header( 'Link: <' . OPERATOR_URL . '>; rel="canonical"' );
		header( 'X-Robots-Tag: noindex' );
		header( 'Cache-Control: public, max-age=300' );
		echo operator_twin(); // phpcs:ignore WordPress.Security.EscapeOutput -- plain-text markdown.
		exit;
	}, -1 );
	add_filter( 'pre_get_document_title', __NAMESPACE__ . '\\operator_document_title', 999 );
	add_filter( 'seopress_titles_title', __NAMESPACE__ . '\\operator_document_title', 999 );
	add_action( 'template_redirect', function () {
		if ( ! operator_is_page() ) {
			return;
		}
		remove_action( 'wp_head', 'rel_canonical' ); // operator_head_html() prints the one canonical.
		if ( ! operator_is_live() && ! headers_sent() ) {
			header( 'X-Robots-Tag: noindex' );
		}
	}, 1 );
	add_filter( 'wp_sitemaps_posts_query_args', __NAMESPACE__ . '\\operator_sitemap_args', 99 );
	add_filter( 'seopress_sitemaps_single_query', __NAMESPACE__ . '\\operator_sitemap_args', 99 );
	add_filter( 'wp_nav_menu_objects', function ( $items ) {
		return operator_menu_objects( $items, operator_is_page(), operator_is_live() );
	}, 20 );
	add_filter( 'nav_menu_link_attributes', __NAMESPACE__ . '\\operator_menu_link_atts', 20, 2 );

	add_action( 'rest_api_init', function () {
		register_rest_route( 'ph-site/v1', '/operator-lead', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => function ( \WP_REST_Request $req ) {
				$b = $req->get_json_params();
				list( $status, $out ) = operator_handle( is_array( $b ) ? $b : array() );
				return new \WP_REST_Response( $out, $status );
			},
		) );
	} );
}
