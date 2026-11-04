<?php
/**
 * PH Blog: magazine layout for the blog (single posts and /blog/), series and "read next" blocks,
 * the right-hand article menu, reading progress, JSON-LD, markdown twins (?format=md) and the blog section of /llms.txt.
 * The Elementor templates hold {{ph-blog-*}} slots that are filled server-side here.
 */

namespace AngieSnippets\PhBlog_10116;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const VER       = '1.0.9';
const BLOG_ID   = 10147;
const AVATAR_ID = 10097;
const WPM       = 200;
const DESKS     = [
	'ai'      => [ 'label' => 'Personalisation & AI', 'cat' => 'personalisation' ],
	'rm'      => [ 'label' => 'Retail Media', 'cat' => 'retail-media' ],
	'store'   => [ 'label' => 'Stores & Experience', 'cat' => 'stores-experience' ],
	'measure' => [ 'label' => 'Measurement', 'cat' => 'measurement' ],
];

/* ---------- post meta for series ---------- */
add_action( 'init', function () {
	$auth = function () {
		return current_user_can( 'edit_posts' );
	};
	foreach ( [ 'ph_series' => 'string', 'ph_series_name' => 'string', 'ph_series_part' => 'integer', 'ph_series_total' => 'integer' ] as $key => $type ) {
		register_post_meta( 'post', $key, [ 'type' => $type, 'single' => true, 'show_in_rest' => true, 'auth_callback' => $auth ] );
	}
} );

/* ---------- helpers ---------- */
function is_blog_page() {
	return is_page( BLOG_ID );
}

function is_blog_post() {
	return is_singular( 'post' );
}

function in_blog() {
	return is_blog_post() || is_blog_page();
}

function desk_of( $post ) {
	$cats = get_the_category( $post->ID );
	foreach ( DESKS as $key => $d ) {
		foreach ( $cats as $c ) {
			if ( $c->slug === $d['cat'] ) {
				return $key;
			}
		}
	}
	return 'ai';
}

function mins_of( $post ) {
	$words = str_word_count( wp_strip_all_tags( do_blocks( $post->post_content ) ) );
	return max( 2, (int) ceil( $words / WPM ) );
}

function series_of( $post ) {
	$key = (string) get_post_meta( $post->ID, 'ph_series', true );
	if ( '' === $key ) {
		return null;
	}
	return [
		'key'   => $key,
		'name'  => (string) get_post_meta( $post->ID, 'ph_series_name', true ),
		'part'  => (int) get_post_meta( $post->ID, 'ph_series_part', true ),
		'total' => (int) get_post_meta( $post->ID, 'ph_series_total', true ),
	];
}

function series_posts( $key ) {
	static $cache = [];
	if ( ! isset( $cache[ $key ] ) ) {
		$cache[ $key ] = get_posts( [
			'post_type'      => 'post',
			'post_status'    => 'publish',
			'posts_per_page' => 50,
			'meta_key'       => 'ph_series_part', // phpcs:ignore WordPress.DB.SlowDBQuery
			'orderby'        => 'meta_value_num',
			'order'          => 'ASC',
			'meta_query'     => [ [ 'key' => 'ph_series', 'value' => $key ] ], // phpcs:ignore WordPress.DB.SlowDBQuery
		] );
	}
	return $cache[ $key ];
}

function all_posts() {
	static $all = null;
	if ( null === $all ) {
		$all = get_posts( [ 'post_type' => 'post', 'post_status' => 'publish', 'posts_per_page' => 200, 'orderby' => 'date', 'order' => 'DESC' ] );
	}
	return $all;
}

function latest_post() {
	$all = all_posts();
	return $all ? $all[0] : null;
}

function svg( $name ) {
	$paths = [
		'next' => 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
		'prev' => 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
		'doc'  => 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
	];
	return '<svg class="ph-blog-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' . $paths[ $name ] . '"/></svg>';
}

function part_text( $s ) {
	return $s ? sprintf( 'Part %d of %d', $s['part'], $s['total'] ) : '';
}

/* ---------- rendered pieces ---------- */
function kick_html( $post, $small = false ) {
	$desk = desk_of( $post );
	$s    = series_of( $post );
	$meta = ( $s ? '<span>' . esc_html( part_text( $s ) ) . '</span>' : '' ) . '<span>' . esc_html( mins_of( $post ) . ' min read' ) . '</span>';
	return '<div class="ph-blog-kick' . ( $small ? ' ph-blog-kick-sm' : '' ) . '" data-desk="' . esc_attr( $desk ) . '"><span class="ph-blog-tag">' . esc_html( DESKS[ $desk ]['label'] ) . '</span><span class="ph-blog-meta">' . $meta . '</span></div>';
}

function dates_text( $post ) {
	$pub = get_post_time( 'U', true, $post );
	$mod = get_post_modified_time( 'U', true, $post );
	$out = esc_html( get_the_date( 'j F Y', $post ) );
	if ( $mod - $pub > DAY_IN_SECONDS ) {
		$out = 'Published ' . $out . ' · Updated ' . esc_html( get_the_modified_date( 'j F Y', $post ) );
	}
	return $out;
}

function byline_html( $post ) {
	$img = AVATAR_ID ? wp_get_attachment_image( AVATAR_ID, 'thumbnail', false, [ 'class' => 'ph-blog-av', 'alt' => 'Rob Geerdink', 'loading' => 'lazy' ] ) : '';
	return '<div class="ph-blog-by">' . $img . '<span><b>Rob Geerdink</b>Founder and CEO, Personalisation Hub<br><span class="ph-blog-date">' . dates_text( $post ) . '</span></span></div>';
}

function head_html( $post, $tag ) {
	$title = esc_html( get_the_title( $post ) );
	if ( 'h1' !== $tag ) {
		$title = '<a href="' . esc_url( get_permalink( $post ) ) . '">' . $title . '</a>';
	}
	$hero = get_the_post_thumbnail( $post, 'full', [ 'class' => 'ph-blog-hero', 'loading' => 'eager', 'fetchpriority' => 'high', 'sizes' => '(max-width: 1024px) 100vw, 760px' ] );
	return kick_html( $post )
		. '<' . $tag . ' class="ph-blog-title">' . $title . '</' . $tag . '>'
		. ( has_excerpt( $post ) ? '<p class="ph-blog-dek">' . esc_html( get_the_excerpt( $post ) ) . '</p>' : '' )
		. byline_html( $post )
		. $hero;
}

function menu_html( $current_id ) {
	$count = [ 'all' => 0 ];
	$items = '';
	foreach ( all_posts() as $i => $p ) {
		$desk           = desk_of( $p );
		$count['all']  += 1;
		$count[ $desk ] = ( $count[ $desk ] ?? 0 ) + 1;
		$thumb          = get_the_post_thumbnail( $p, 'medium', [ 'class' => 'ph-blog-mi-img', 'loading' => 'lazy', 'alt' => '' ] );
		$items         .= '<a class="ph-blog-mi" href="' . esc_url( get_permalink( $p ) ) . '" data-desk="' . esc_attr( $desk ) . '" data-date="' . esc_attr( get_post_time( 'U', true, $p ) ) . '" data-mins="' . esc_attr( mins_of( $p ) ) . '" data-i="' . (int) $i . '"' . ( (int) $p->ID === (int) $current_id ? ' aria-current="page"' : '' ) . '>'
			. '<span class="ph-blog-mi-th">' . $thumb . '</span><span>' . kick_html( $p, true ) . '<b>' . esc_html( get_the_title( $p ) ) . '</b></span></a>';
	}
	$opts = '<option value="all">' . esc_html( 'All sections (' . $count['all'] . ')' ) . '</option>';
	foreach ( DESKS as $key => $d ) {
		$opts .= '<option value="' . esc_attr( $key ) . '">' . esc_html( $d['label'] . ' (' . ( $count[ $key ] ?? 0 ) . ')' ) . '</option>';
	}
	$n = $count['all'];
	return '<nav class="ph-blog-menu" aria-label="Articles"><div class="ph-blog-menu-in"><div class="ph-blog-menu-top">'
		. '<div class="ph-blog-menu-h"><h2>Articles</h2><label class="screen-reader-text" for="ph-blog-section">Filter by section</label><select id="ph-blog-section" class="ph-blog-sel">' . $opts . '</select></div>'
		. '<div class="ph-blog-menu-sub"><span class="ph-blog-count" aria-live="polite">' . esc_html( $n . ( 1 === $n ? ' article' : ' articles' ) ) . '</span></div>'
		. '</div><div class="ph-blog-mwrap"><div class="ph-blog-mlist">' . $items . '<p class="ph-blog-empty" hidden>No articles in this section yet.</p></div><div class="ph-blog-sbar" aria-hidden="true"><span></span></div></div></div></nav>';
}

function series_html( $post, $s ) {
	$list = series_posts( $s['key'] );
	if ( count( $list ) < 2 ) {
		return '';
	}
	$total = max( $s['total'], count( $list ) );
	$dots  = '';
	$next  = null;
	foreach ( $list as $p ) {
		$part  = (int) get_post_meta( $p->ID, 'ph_series_part', true );
		$cur   = (int) $p->ID === (int) $post->ID;
		$dots .= '<a href="' . esc_url( get_permalink( $p ) ) . '"' . ( $part < $s['part'] ? ' class="done"' : '' ) . ( $cur ? ' aria-current="page"' : '' ) . ' aria-label="' . esc_attr( 'Part ' . $part . ': ' . get_the_title( $p ) ) . '"></a>';
		if ( ! $next && $part > $s['part'] ) {
			$next = $p;
		}
	}
	$name = $s['name'] ? '<span class="ph-blog-series-name">' . esc_html( $s['name'] ) . '</span>' : '';
	if ( $next ) {
		$np    = (int) get_post_meta( $next->ID, 'ph_series_part', true );
		$read  = sprintf( "You’ve read part %d of %d", $s['part'], $total );
		$body  = '<h3>Up next</h3><a class="ph-blog-nt" href="' . esc_url( get_permalink( $next ) ) . '">' . esc_html( get_the_title( $next ) ) . '</a>'
			. '<a class="ph-blog-sbtn" href="' . esc_url( get_permalink( $next ) ) . '">' . esc_html( sprintf( 'Read part %d of %d', $np, $total ) ) . svg( 'next' ) . '</a>';
	} else {
		$first = $list[0];
		$read  = "You’ve finished the series";
		$body  = '<h3>Start again</h3><a class="ph-blog-nt" href="' . esc_url( get_permalink( $first ) ) . '">' . esc_html( get_the_title( $first ) ) . '</a>'
			. '<a class="ph-blog-sbtn" href="' . esc_url( get_permalink( $first ) ) . '">' . esc_html( 'Back to part 1' ) . svg( 'next' ) . '</a>';
	}
	return '<section class="ph-blog-series" data-desk="' . esc_attr( desk_of( $post ) ) . '" aria-label="Continue the series"><div class="ph-blog-series-top"><span>' . $name . esc_html( $read ) . '</span><nav class="ph-blog-dots" aria-label="Series parts">' . $dots . '</nav></div>' . $body . '</section>';
}

function snav_html( $post, $s ) {
	$list = series_posts( $s['key'] );
	if ( count( $list ) < 2 ) {
		return '';
	}
	$total = max( $s['total'], count( $list ) );
	$prev  = null;
	$next  = null;
	foreach ( $list as $p ) {
		$part = (int) get_post_meta( $p->ID, 'ph_series_part', true );
		if ( $part < $s['part'] ) {
			$prev = $p;
		}
		if ( ! $next && $part > $s['part'] ) {
			$next = $p;
		}
	}
	$out = '<nav class="ph-blog-snav" aria-label="Series">';
	if ( $prev ) {
		$pp   = (int) get_post_meta( $prev->ID, 'ph_series_part', true );
		$out .= '<a class="ph-blog-sprev" href="' . esc_url( get_permalink( $prev ) ) . '" title="' . esc_attr( get_the_title( $prev ) ) . '">' . svg( 'prev' ) . '<span class="lg">' . esc_html( sprintf( 'Previous: part %d of %d', $pp, $total ) ) . '</span><span class="sh">' . esc_html( sprintf( 'Part %d', $pp ) ) . '</span></a>';
	}
	if ( $next ) {
		$np   = (int) get_post_meta( $next->ID, 'ph_series_part', true );
		$out .= '<a class="ph-blog-snext" href="' . esc_url( get_permalink( $next ) ) . '" title="' . esc_attr( get_the_title( $next ) ) . '"><span><span class="lg">' . esc_html( sprintf( 'Next: part %d of %d', $np, $total ) ) . '</span><span class="sh">' . esc_html( sprintf( 'Next: part %d', $np ) ) . '</span></span>' . svg( 'next' ) . '</a>';
	} else {
		$out .= '<a class="ph-blog-snext" href="' . esc_url( get_permalink( $list[0] ) ) . '" title="' . esc_attr( get_the_title( $list[0] ) ) . '"><span><span class="lg">' . esc_html( sprintf( 'Back to part 1 of %d', $total ) ) . '</span><span class="sh">Back to part 1</span></span>' . svg( 'next' ) . '</a>';
	}
	return $out . '</nav>';
}

function readnext_html( $post ) {
	$desk = desk_of( $post );
	$pick = null;
	foreach ( all_posts() as $p ) {
		if ( (int) $p->ID !== (int) $post->ID && desk_of( $p ) === $desk ) {
			$pick = $p;
			break;
		}
	}
	if ( ! $pick ) {
		foreach ( all_posts() as $p ) {
			if ( (int) $p->ID !== (int) $post->ID ) {
				$pick = $p;
				break;
			}
		}
	}
	if ( ! $pick ) {
		return '';
	}
	$thumb = get_the_post_thumbnail( $pick, 'medium_large', [ 'class' => 'ph-blog-rn-img', 'loading' => 'lazy', 'alt' => '' ] );
	return '<section class="ph-blog-rn" data-desk="' . esc_attr( desk_of( $pick ) ) . '" aria-label="Read next"><h3>Read next</h3><a class="ph-blog-rn-card" href="' . esc_url( get_permalink( $pick ) ) . '"><span class="ph-blog-rn-th">' . $thumb . '</span><span>' . kick_html( $pick, true ) . '<b>' . esc_html( get_the_title( $pick ) ) . '</b><span class="ph-blog-rn-go">Read the article' . svg( 'next' ) . '</span></span></a></section>';
}

/* series or read-next block at the end of every post body */
add_filter( 'the_content', function ( $html ) {
	static $done = [];
	if ( is_feed() || is_admin() ) {
		return $html;
	}
	$post = get_post();
	if ( ! $post || 'post' !== $post->post_type || isset( $done[ $post->ID ] ) || ! ( in_blog() || ! empty( $GLOBALS['ph_blog_rendering'] ) ) ) {
		return $html;
	}
	$done[ $post->ID ] = true;
	$s = series_of( $post );
	if ( $s ) {
		$nav = snav_html( $post, $s );
		$at  = false;
		foreach ( [ '<aside class="ph-blog-act"', '<div class="ph-blog-rel"', '<div class="ph-blog-src"' ] as $mark ) {
			$at = strpos( $html, $mark );
			if ( false !== $at ) {
				break;
			}
		}
		$html = false === $at ? $html . $nav : substr( $html, 0, $at ) . $nav . substr( $html, $at );
	}
	return $html . ( $s ? series_html( $post, $s ) : readnext_html( $post ) );
}, 30 );

/* ---------- slots in the Elementor templates ---------- */
function slots() {
	if ( is_blog_post() ) {
		$post = get_queried_object();
		return [
			'kick'   => kick_html( $post ),
			'byline' => byline_html( $post ),
			'head'   => head_html( $post, 'h1' ),
			'menu'   => menu_html( $post->ID ),
		];
	}
	$latest = latest_post();
	if ( ! $latest ) {
		return [ 'latest' => '', 'menu' => '' ];
	}
	$keep = $GLOBALS['post'] ?? null;
	$GLOBALS['post'] = $latest; // phpcs:ignore WordPress.WP.GlobalVariablesOverride
	setup_postdata( $latest );
	$GLOBALS['ph_blog_rendering'] = true;
	$body = apply_filters( 'the_content', $latest->post_content ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals
	$GLOBALS['ph_blog_rendering'] = false;
	$GLOBALS['post'] = $keep; // phpcs:ignore WordPress.WP.GlobalVariablesOverride
	wp_reset_postdata();
	return [
		'latest' => '<article class="ph-blog-article" data-desk="' . esc_attr( desk_of( $latest ) ) . '">' . head_html( $latest, 'h2' ) . '<div class="ph-blog-body">' . $body . '</div></article>',
		'menu'   => menu_html( $latest->ID ),
	];
}

add_action( 'template_redirect', function () {
	if ( ! in_blog() || is_admin() || wp_doing_ajax() || isset( $_GET['elementor-preview'] ) || isset( $_GET['format'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		return;
	}
	$slots = slots();
	ob_start( function ( $html ) use ( $slots ) {
		return preg_replace_callback(
			'#<(p|div|span|h[1-6])\b[^>]*>\s*\{\{ph-blog-([a-z]+)\}\}\s*</\1>#',
			function ( $m ) use ( $slots ) {
				return $slots[ $m[2] ] ?? '';
			},
			$html
		);
	} );
}, 99 );

/* ---------- assets and body classes ---------- */
add_filter( 'body_class', function ( $classes ) {
	if ( in_blog() ) {
		$classes[] = 'ph-blog';
		$post      = is_blog_post() ? get_queried_object() : latest_post();
		if ( $post ) {
			$classes[] = 'ph-desk-' . desk_of( $post );
		}
	}
	return $classes;
} );

add_action( 'wp_enqueue_scripts', function () {
	if ( ! in_blog() ) {
		return;
	}
	wp_enqueue_style( 'ph-blog-10116', angie_cs_get_snippet_asset_url( __FILE__, 'blog.css' ), [], VER );
	wp_enqueue_script( 'ph-blog-10116', angie_cs_get_snippet_asset_url( __FILE__, 'blog.js' ), [], VER, true );
}, 20 );

/* ---------- category archives fold into the blog menu ---------- */
add_action( 'template_redirect', function () {
	if ( ! is_category() ) {
		return;
	}
	$cat = get_queried_object();
	$to  = home_url( '/blog/' );
	foreach ( DESKS as $key => $d ) {
		if ( $cat && $cat->slug === $d['cat'] ) {
			$to = add_query_arg( 'section', $key, $to );
		}
	}
	wp_safe_redirect( $to, 301 );
	exit;
}, 5 );

/* ---------- structured data ---------- */
/** Identical to PH Agent Endpoint's organization_node(): one Organization on every page. */
function org() {
	return [
		'@type'       => 'Organization',
		'@id'         => home_url( '/#organization' ),
		'name'        => 'Personalisation Hub',
		'url'         => home_url( '/' ),
		'description' => "Self-hosted, self-optimising omnichannel personalisation and retail media platform for physical retail, deployed in the retailer's own cloud.",
	];
}

/** Identical to PH Agent Endpoint's software_node(): one SoftwareApplication on every page. */
function software() {
	return [
		'@type'               => 'SoftwareApplication',
		'@id'                 => home_url( '/#software' ),
		'name'                => 'Personalisation Hub',
		'url'                 => home_url( '/' ),
		'description'         => "Self-hosted, self-optimising omnichannel personalisation and retail media platform for physical retail, deployed in the retailer's own cloud.",
		'applicationCategory' => 'BusinessApplication',
		'operatingSystem'     => 'Web',
		'publisher'           => [ '@id' => home_url( '/#organization' ) ],
		'offers'              => [
			'@type'         => 'Offer',
			'name'          => 'Free trial on AWS Marketplace',
			'price'         => '0',
			'priceCurrency' => 'USD',
			'url'           => 'https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76',
			'availability'  => 'https://schema.org/InStock',
			'description'   => "30-day free trial on AWS Marketplace, then billed through the customer's AWS account",
		],
	];
}

function author() {
	return [ '@type' => 'Person', 'name' => 'Rob Geerdink', 'jobTitle' => 'Founder and CEO', 'worksFor' => [ '@id' => home_url( '/#organization' ) ], 'sameAs' => [ 'https://www.linkedin.com/in/robertgeerdink/' ] ];
}

function post_ld( $post ) {
	$url  = get_permalink( $post );
	$s    = series_of( $post );
	$tags = wp_get_post_tags( $post->ID, [ 'fields' => 'names' ] );
	$desc = (string) get_post_meta( $post->ID, '_seopress_titles_desc', true );
	$item = [
		'@type'            => [ 'BlogPosting', 'Article' ],
		'@id'              => $url . '#article',
		'headline'         => get_the_title( $post ),
		'description'      => $desc ? $desc : get_the_excerpt( $post ),
		'url'              => $url,
		'mainEntityOfPage' => $url,
		'inLanguage'       => 'en-GB',
		'datePublished'    => get_post_time( 'c', true, $post ),
		'dateModified'     => get_post_modified_time( 'c', true, $post ),
		'articleSection'   => DESKS[ desk_of( $post ) ]['label'],
		'keywords'         => $tags,
		'wordCount'        => str_word_count( wp_strip_all_tags( do_blocks( $post->post_content ) ) ),
		'timeRequired'     => 'PT' . mins_of( $post ) . 'M',
		'author'           => author(),
		'publisher'        => [ '@id' => home_url( '/#organization' ) ],
		'isPartOf'         => [ '@type' => 'Blog', '@id' => home_url( '/blog/#blog' ), 'name' => 'Personalisation Hub Blog', 'url' => home_url( '/blog/' ) ],
		'about'            => array_map( function ( $t ) {
			return [ '@type' => 'Thing', 'name' => $t ];
		}, $tags ),
	];
	$img = get_the_post_thumbnail_url( $post, 'full' );
	if ( $img ) {
		$item['image'] = $img;
	}
	if ( $s && $s['name'] ) {
		$item['position'] = $s['part'];
	}
	return $item;
}

add_action( 'wp_head', function () {
	if ( ! in_blog() ) {
		return;
	}
	if ( is_blog_post() ) {
		$post  = get_queried_object();
		$graph = [ post_ld( $post ), org(), software(), [ '@type' => 'BreadcrumbList', 'itemListElement' => [
			[ '@type' => 'ListItem', 'position' => 1, 'name' => 'Blog', 'item' => home_url( '/blog/' ) ],
			[ '@type' => 'ListItem', 'position' => 2, 'name' => get_the_title( $post ), 'item' => get_permalink( $post ) ],
		] ] ];
		$md    = add_query_arg( 'format', 'md', get_permalink( $post ) );
	} else {
		$posts = array_map( function ( $p ) {
			return [ '@type' => 'BlogPosting', 'headline' => get_the_title( $p ), 'url' => get_permalink( $p ), 'datePublished' => get_post_time( 'c', true, $p ) ];
		}, all_posts() );
		$graph = [ [ '@type' => 'Blog', '@id' => home_url( '/blog/#blog' ), 'name' => 'Personalisation Hub Blog', 'url' => home_url( '/blog/' ), 'inLanguage' => 'en-GB', 'description' => 'Practical analysis of retail media, in-store personalisation and AI for people building the next generation of retail.', 'publisher' => [ '@id' => home_url( '/#organization' ) ], 'author' => author(), 'blogPost' => $posts ], org(), software(), [ '@type' => 'BreadcrumbList', 'itemListElement' => [ [ '@type' => 'ListItem', 'position' => 1, 'name' => 'Blog', 'item' => home_url( '/blog/' ) ] ] ] ];
		$md    = add_query_arg( 'format', 'md', home_url( '/blog/' ) );
	}
	echo '<script type="application/ld+json">' . wp_json_encode( [ '@context' => 'https://schema.org', '@graph' => $graph ], JSON_UNESCAPED_SLASHES | JSON_HEX_TAG ) . '</script>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput
	echo '<link rel="alternate" type="text/markdown" href="' . esc_url( $md ) . '">' . "\n";
}, 21 );

/* ---------- markdown twins and llms.txt ---------- */
function html_to_md( $html ) {
	$h = preg_replace( '#<(svg|script|style|button|nav)\b.*?</\1>#is', '', $html );
	$h = preg_replace( '#<pre[^>]*>(.*?)</pre>#is', "\n\n```\n$1\n```\n\n", $h );
	$h = preg_replace_callback( '#<img\b[^>]*>#i', function ( $m ) {
		$src = preg_match( '#src="([^"]+)"#', $m[0], $a ) ? $a[1] : '';
		$alt = preg_match( '#alt="([^"]*)"#', $m[0], $b ) ? $b[1] : '';
		return $src ? "\n\n![" . $alt . '](' . $src . ")\n\n" : '';
	}, $h );
	$h = preg_replace( '#<video\b[^>]*src="([^"]+)"[^>]*>.*?</video>#is', "\n\n[Video]($1)\n\n", $h );
	$h = preg_replace( '#<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>#is', '[$2]($1)', $h );
	$h = preg_replace( '#<h2[^>]*>(.*?)</h2>#is', "\n\n## $1\n\n", $h );
	$h = preg_replace( '#<h3[^>]*>(.*?)</h3>#is', "\n\n### $1\n\n", $h );
	$h = preg_replace( '#<li[^>]*>(.*?)</li>#is', "\n- $1", $h );
	$h = preg_replace_callback( '#<blockquote[^>]*>(.*?)</blockquote>#is', function ( $m ) {
		return "\n\n> " . trim( wp_strip_all_tags( $m[1] ) ) . "\n\n";
	}, $h );
	$h = preg_replace( '#<(strong|b)>(.*?)</\1>#is', '**$2**', $h );
	$h = preg_replace( '#</(p|div|section|aside|figure|ul|ol)>#i', "\n\n", $h );
	$h = html_entity_decode( wp_strip_all_tags( $h ), ENT_QUOTES, 'UTF-8' );
	$h = preg_replace( "#[ \t]+\n#", "\n", $h );
	$h = preg_replace( "#\n{3,}#", "\n\n", $h );
	$h = preg_replace( "#(\n- [^\n]*)\n\n(?=- )#", "$1\n", $h );
	$h = preg_replace( "#(\n- [^\n]*)\n\n(?=- )#", "$1\n", $h );
	return trim( $h );
}

function post_md( $post ) {
	$s   = series_of( $post );
	$out = '# ' . get_the_title( $post ) . "\n\n";
	if ( has_excerpt( $post ) ) {
		$out .= '> ' . get_the_excerpt( $post ) . "\n\n";
	}
	$out .= 'By Rob Geerdink, Founder and CEO, Personalisation Hub · ' . wp_strip_all_tags( dates_text( $post ) ) . ' · ' . DESKS[ desk_of( $post ) ]['label'] . ( $s ? ' · ' . part_text( $s ) . ( $s['name'] ? ' of ' . $s['name'] : '' ) : '' ) . "\n\n";
	$out .= 'URL: ' . get_permalink( $post ) . "\n\n";
	return $out . html_to_md( do_blocks( $post->post_content ) ) . "\n";
}

add_action( 'template_redirect', function () {
	if ( ! isset( $_GET['format'] ) || 'md' !== sanitize_key( wp_unslash( $_GET['format'] ) ) || ! in_blog() ) { // phpcs:ignore WordPress.Security.NonceVerification
		return;
	}
	if ( is_blog_post() ) {
		$md = post_md( get_queried_object() );
	} else {
		$md = "# Personalisation Hub Blog\n\n> Practical analysis of retail media, in-store personalisation and AI for people building the next generation of retail. Written by Rob Geerdink, founder and CEO of Personalisation Hub.\n\n";
		foreach ( all_posts() as $p ) {
			$md .= '- [' . get_the_title( $p ) . '](' . add_query_arg( 'format', 'md', get_permalink( $p ) ) . '): ' . get_the_excerpt( $p ) . "\n";
		}
	}
	status_header( 200 );
	header( 'Content-Type: text/markdown; charset=utf-8' );
	header( 'X-Robots-Tag: noindex' );
	header( 'X-Content-Type-Options: nosniff' );
	echo $md; // phpcs:ignore WordPress.Security.EscapeOutput -- plain-text markdown.
	exit;
}, 1 );

add_filter( 'ph_llms_txt', function ( $txt ) {
	$md = "## Blog\n\n- [Personalisation Hub Blog](" . add_query_arg( 'format', 'md', home_url( '/blog/' ) ) . "): practical analysis of retail media, in-store personalisation and AI.\n";
	foreach ( all_posts() as $p ) {
		$md .= '- [' . get_the_title( $p ) . '](' . add_query_arg( 'format', 'md', get_permalink( $p ) ) . '): ' . get_the_excerpt( $p ) . "\n";
	}
	return rtrim( $txt ) . "\n\n" . $md;
} );
