<?php
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_LEGACY_COPY_TEST' ) ) {
	exit;
}

/*
 * Fourth one-time content migration (13 Nov 2026): the copy fixes from the 13 Nov full-site check
 * (retired offer word, UK spelling, typo, image alt text) on Elementor V3 pages the MCP can't edit.
 *
 * Unlike v2/v3 it needs no element ids: every post with _elementor_data (any public type, plus
 * Theme Builder templates) is walked, and each RULE swaps an exact string wherever it appears in the
 * visible text of a setting. Text inside HTML tags (href, src, class) and URL/CSS/id settings is
 * never touched. `find` is matched with the v2 typography normalisation (&amp;/&, &nbsp;/space).
 * The same rules run on the posts' SEOPress title/description/social meta, the front page's SEOPress
 * meta and the SEOPress options. Attachments: an alt/title/caption containing "Revenie" (home page
 * og:image:alt) is corrected, and an image whose alt or title is exactly "personalized" (on
 * /store-sites/) becomes "Personalised campaign targeting".
 *
 * Options: ph_legacy_copy_v4 (run result: every replacement made, every rule skipped, and a residue
 * list of the checked words still present, for the post-deploy scan), ph_legacy_copy_v4_lock (atomic
 * add_option lock), ph_legacy_copy_v4_rollback (exact before/after per changed value). Rollback: set
 * ph_legacy_copy_v4_rollback_request to 1 and load any page; each value still equal to its "after" is
 * put back to "before", the outcome is in ph_legacy_copy_v4_rollback_result. Runs once on init, priority 25 (the rollback check at 24).
 */

const LEGACY_COPY_V4_DONE_OPTION        = 'ph_legacy_copy_v4';
const LEGACY_COPY_V4_LOCK_OPTION        = 'ph_legacy_copy_v4_lock';
const LEGACY_COPY_V4_ROLLBACK_OPTION    = 'ph_legacy_copy_v4_rollback';
const LEGACY_COPY_V4_RB_REQUEST_OPTION  = 'ph_legacy_copy_v4_rollback_request';
const LEGACY_COPY_V4_RB_RESULT_OPTION   = 'ph_legacy_copy_v4_rollback_result';
const LEGACY_COPY_V4_ALT_TEXT           = 'Personalised campaign targeting';

/** Ordered rules. Each pair is [find, replace]; the first pair is the ticket's exact string, the rest are its case variants. */
function legacy_copy_v4_rules() {
	return array(
		array( 'id' => 'qsr-retired-word', 'where' => '/industries/qsr/', 'pairs' => array(
			array( 'Franchised or company-owned, every restaurant runs from one secure platform', 'Owner-operated or company-owned, every restaurant runs from one secure platform' ),
		) ),
		array( 'id' => 'licence-uk-spelling', 'where' => 'pricing table (/, /white-label-retail-media-platform/, /digital-signage/, /retail-appointment-bookings/ and the rest)', 'pairs' => array(
			array( 'Base Platform License', 'Base Platform Licence' ),
			array( 'Base platform license', 'Base platform licence' ),
			array( 'BASE PLATFORM LICENSE', 'BASE PLATFORM LICENCE' ),
		) ),
		array( 'id' => 'optimisation-uk-spelling', 'where' => '/retail-queue-management/', 'pairs' => array(
			array( 'staffing & service optimization', 'staffing & service optimisation' ),
			array( 'Staffing & Service Optimization', 'Staffing & Service Optimisation' ),
			array( 'Staffing & service optimization', 'Staffing & service optimisation' ),
		) ),
		array( 'id' => 'omnichannel', 'where' => '/amazon-signage/', 'pairs' => array(
			array( 'omni-channel', 'omnichannel' ),
			array( 'Omni-channel', 'Omnichannel' ),
			array( 'Omni-Channel', 'Omnichannel' ),
			array( 'OMNI-CHANNEL', 'OMNICHANNEL' ),
		) ),
		array( 'id' => 'revenue-typo', 'where' => 'home page social image alt (og:image:alt)', 'pairs' => array(
			array( 'Revenie', 'Revenue' ),
			array( 'revenie', 'revenue' ),
			array( 'REVENIE', 'REVENUE' ),
		) ),
	);
}

/** Words the post-deploy scan must not find (reported, never changed, so a human can judge quoted third-party names). */
function legacy_copy_v4_residue_regex() {
	return '/\w*(?:franch|personaliz|optimiz|revenie)\w*|\blicenses?\b|omni-channel/iu';
}

/** Setting keys whose values are never copy. */
function legacy_copy_v4_skip_key( $key ) {
	return in_array( (string) $key, array( 'id', '_id', 'elType', 'widgetType', 'url', 'link', 'href', 'source', 'custom_css', '_element_id', '_css_classes', 'css_classes', 'html_tag', 'header_size', '__dynamic__', '__globals__', 'external_url', 'video_url', 'youtube_url', 'vimeo_url' ), true )
		|| '_url' === substr( (string) $key, -4 );
}

function legacy_copy_v4_url_like( $s ) {
	return (bool) preg_match( '~^\s*(?:https?:|//|/|#|mailto:|tel:)~i', $s );
}

/** Replace $find by $replace in the text of $s, never inside an HTML tag. Returns array( new, count ). */
function legacy_copy_v4_replace_text( $s, $find, $replace ) {
	$re    = '/' . legacy_copy_v2_pattern( $find ) . '/u';
	$parts = preg_split( '/(<[^>]*>)/', $s, -1, PREG_SPLIT_DELIM_CAPTURE );
	if ( false === $parts ) {
		return array( $s, 0 );
	}
	$count = 0;
	foreach ( $parts as $i => $part ) {
		if ( '' === $part || '<' === $part[0] ) {
			continue;
		}
		$n   = 0;
		$new = @preg_replace_callback( $re, function () use ( $replace ) { return $replace; }, $part, -1, $n );
		if ( null !== $new && $n > 0 ) {
			$parts[ $i ] = $new;
			$count      += $n;
		}
	}
	return array( implode( '', $parts ), $count );
}

/** Apply every rule to one string. Returns array( new, array( rule_id => count ) ). */
function legacy_copy_v4_apply_rules( $s, array $rules ) {
	$hits = array();
	if ( ! is_string( $s ) || '' === $s || legacy_copy_v4_url_like( $s ) ) {
		return array( $s, $hits );
	}
	foreach ( $rules as $rule ) {
		foreach ( $rule['pairs'] as $pair ) {
			list( $s, $n ) = legacy_copy_v4_replace_text( $s, $pair[0], $pair[1] );
			if ( $n > 0 ) {
				$hits[ $rule['id'] ] = ( $hits[ $rule['id'] ] ?? 0 ) + $n;
			}
		}
	}
	return array( $s, $hits );
}

function legacy_copy_v4_is_personalized( $s ) {
	return is_string( $s ) && 'personalized' === strtolower( trim( $s ) );
}

/**
 * Walk decoded _elementor_data, applying the rules to every copy string. An image control's
 * alt/title that is exactly "personalized" is set to the agreed alt text. Returns
 * array( data, changes ) where each change is array( path, before, after, hits ).
 */
function legacy_copy_v4_walk( $node, array $rules, array $path = array() ) {
	$changes = array();
	if ( ! is_array( $node ) ) {
		return array( $node, $changes );
	}
	$is_image = isset( $node['url'] ) && is_string( $node['url'] ) && array_key_exists( 'id', $node );
	foreach ( $node as $key => $value ) {
		if ( legacy_copy_v4_skip_key( $key ) ) {
			continue;
		}
		$p = array_merge( $path, array( $key ) );
		if ( is_array( $value ) ) {
			list( $node[ $key ], $sub ) = legacy_copy_v4_walk( $value, $rules, $p );
			$changes                    = array_merge( $changes, $sub );
			continue;
		}
		if ( ! is_string( $value ) ) {
			continue;
		}
		if ( $is_image && in_array( $key, array( 'alt', 'title' ), true ) && legacy_copy_v4_is_personalized( $value ) ) {
			$node[ $key ] = LEGACY_COPY_V4_ALT_TEXT;
			$changes[]    = array( $p, $value, LEGACY_COPY_V4_ALT_TEXT, array( 'store-sites-alt' => 1 ) );
			continue;
		}
		list( $new, $hits ) = legacy_copy_v4_apply_rules( $value, $rules );
		if ( $hits && $new !== $value ) {
			$node[ $key ] = $new;
			$changes[]    = array( $p, $value, $new, $hits );
		}
	}
	return array( $node, $changes );
}

/** Attachment ids referenced by image controls in decoded _elementor_data. */
function legacy_copy_v4_image_ids( $node, array &$ids ) {
	if ( ! is_array( $node ) ) {
		return;
	}
	if ( isset( $node['url'] ) && is_string( $node['url'] ) && isset( $node['id'] ) && is_numeric( $node['id'] ) && (int) $node['id'] > 0 ) {
		$ids[ (int) $node['id'] ] = true;
	}
	foreach ( $node as $v ) {
		if ( is_array( $v ) ) {
			legacy_copy_v4_image_ids( $v, $ids );
		}
	}
}

/** Residue: the checked words still in copy strings, with context. */
function legacy_copy_v4_residue( $node, array $where, array $path, array &$out ) {
	if ( count( $out ) >= 200 || ! is_array( $node ) ) {
		return;
	}
	foreach ( $node as $key => $value ) {
		if ( legacy_copy_v4_skip_key( $key ) ) {
			continue;
		}
		$p = array_merge( $path, array( $key ) );
		if ( is_array( $value ) ) {
			legacy_copy_v4_residue( $value, $where, $p, $out );
		} elseif ( is_string( $value ) && ! legacy_copy_v4_url_like( $value ) ) {
			legacy_copy_v4_residue_string( $value, $where + array( 'path' => implode( '.', $p ) ), $out );
		}
	}
}

function legacy_copy_v4_residue_string( $s, array $where, array &$out ) {
	$text = preg_replace( '/<[^>]*>/', ' ', $s );
	if ( ! preg_match_all( legacy_copy_v4_residue_regex(), $text, $m, PREG_OFFSET_CAPTURE ) ) {
		return;
	}
	foreach ( $m[0] as $hit ) {
		if ( count( $out ) >= 200 ) {
			return;
		}
		$start = max( 0, $hit[1] - 40 );
		$out[] = $where + array( 'term' => $hit[0], 'context' => trim( substr( $text, $start, 100 ) ) );
	}
}

/** SEOPress meta keys holding copy. */
function legacy_copy_v4_seo_keys() {
	return array( '_seopress_titles_title', '_seopress_titles_desc', '_seopress_social_fb_title', '_seopress_social_fb_desc', '_seopress_social_twitter_title', '_seopress_social_twitter_desc' );
}

function legacy_copy_v4_post_types() {
	$types = function_exists( 'get_post_types' ) ? array_values( get_post_types( array( 'public' => true ) ) ) : array();
	$types = array_merge( $types, array( 'page', 'post', 'elementor_library' ) );
	return array_values( array_diff( array_unique( $types ), array( 'attachment' ) ) );
}

function legacy_copy_v4_elementor_posts() {
	return array_map( 'intval', (array) get_posts( array(
		'post_type'        => legacy_copy_v4_post_types(),
		'post_status'      => array( 'publish', 'private', 'future' ),
		'meta_key'         => '_elementor_data',
		'posts_per_page'   => -1,
		'fields'           => 'ids',
		'orderby'          => 'ID',
		'order'            => 'ASC',
		'no_found_rows'    => true,
		'suppress_filters' => true,
	) ) );
}

function legacy_copy_v4_hits_into( array &$tally, array $hits, array $where ) {
	foreach ( $hits as $rule => $n ) {
		$tally[ $rule ][] = $where + array( 'count' => $n );
	}
}

/** Value at $path inside a nested array, or null when the path is gone. */
function legacy_copy_v4_get_at( $data, array $path ) {
	foreach ( $path as $k ) {
		if ( ! is_array( $data ) || ! array_key_exists( $k, $data ) ) {
			return null;
		}
		$data = $data[ $k ];
	}
	return $data;
}

/** Set the value at $path inside a nested array. Returns false when the path is gone. */
function legacy_copy_v4_set_at( array &$data, array $path, $value ) {
	$node = &$data;
	foreach ( $path as $k ) {
		if ( ! is_array( $node ) || ! array_key_exists( $k, $node ) ) {
			return false;
		}
		$node = &$node[ $k ];
	}
	$node = $value;
	return true;
}

function legacy_copy_v4_decode( $raw ) {
	$data = is_string( $raw ) ? json_decode( $raw, true ) : $raw;
	return is_array( $data ) ? $data : null;
}

function legacy_copy_v4_save_elementor( $post_id, array $data ) {
	update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $data ) ) );
	legacy_copy_v2_clear_caches( $post_id );
}

function legacy_copy_v4_update_post_field( $post_id, $field, $value ) {
	return wp_update_post( wp_slash( array( 'ID' => $post_id, $field => $value ) ), true );
}

function legacy_copy_v4_run() {
	if ( get_option( LEGACY_COPY_V4_DONE_OPTION ) ) {
		return;
	}
	// add_option fails when the row exists: atomic, so two requests cannot both run the migration.
	if ( ! add_option( LEGACY_COPY_V4_LOCK_OPTION, (string) time(), '', 'no' ) ) {
		return;
	}
	$rules    = legacy_copy_v4_rules();
	$rollback = array();
	$tally    = array();
	$residue  = array();
	$posts    = legacy_copy_v4_elementor_posts();
	$images   = array();

	/* 1. Elementor data and the SEOPress copy meta of every Elementor post. */
	foreach ( $posts as $post_id ) {
		$data = legacy_copy_v4_decode( get_post_meta( $post_id, '_elementor_data', true ) );
		if ( null === $data ) {
			continue;
		}
		list( $new, $changes ) = legacy_copy_v4_walk( $data, $rules );
		if ( $changes ) {
			legacy_copy_v4_save_elementor( $post_id, $new );
			foreach ( $changes as $c ) {
				$rollback[] = array( 'kind' => 'elementor', 'post' => $post_id, 'path' => $c[0], 'before' => $c[1], 'after' => $c[2] );
				legacy_copy_v4_hits_into( $tally, $c[3], array( 'kind' => 'elementor', 'post' => $post_id, 'path' => implode( '.', $c[0] ) ) );
			}
		}
		legacy_copy_v4_residue( $new, array( 'kind' => 'elementor', 'post' => $post_id ), array(), $residue );
		$ids = array();
		legacy_copy_v4_image_ids( $new, $ids );
		foreach ( array_keys( $ids ) as $aid ) {
			$images[ $aid ] = true;
		}
	}
	$front    = (int) get_option( 'page_on_front' );
	$seo_jobs = array();
	foreach ( $posts as $post_id ) {
		$seo_jobs[ $post_id ] = legacy_copy_v4_seo_keys();
	}
	if ( $front > 0 ) {
		$all_meta = get_post_meta( $front );
		$keys     = array();
		foreach ( is_array( $all_meta ) ? $all_meta : array() as $k => $v ) {
			if ( 0 === strpos( (string) $k, '_seopress' ) ) {
				$keys[] = $k;
			}
		}
		$seo_jobs[ $front ] = array_values( array_unique( array_merge( $seo_jobs[ $front ] ?? array(), legacy_copy_v4_seo_keys(), $keys ) ) );
	}
	foreach ( $seo_jobs as $post_id => $keys ) {
		foreach ( $keys as $key ) {
			$cur = get_post_meta( $post_id, $key, true );
			if ( ! is_string( $cur ) || '' === $cur ) {
				continue;
			}
			list( $new, $hits ) = legacy_copy_v4_apply_rules( $cur, $rules );
			if ( $hits && $new !== $cur ) {
				update_post_meta( $post_id, $key, wp_slash( $new ) );
				$rollback[] = array( 'kind' => 'meta', 'post' => $post_id, 'key' => $key, 'before' => $cur, 'after' => $new );
				legacy_copy_v4_hits_into( $tally, $hits, array( 'kind' => 'meta', 'post' => $post_id, 'key' => $key ) );
			}
			legacy_copy_v4_residue_string( $new, array( 'kind' => 'meta', 'post' => $post_id, 'key' => $key ), $residue );
		}
	}

	/* 2. SEOPress options (site-wide social and title settings, including the home page social image alt). */
	foreach ( array( 'seopress_social_option_name', 'seopress_titles_option_name' ) as $opt ) {
		$val = get_option( $opt );
		if ( ! is_array( $val ) ) {
			continue;
		}
		list( $new, $changes ) = legacy_copy_v4_walk( $val, $rules );
		if ( $changes ) {
			update_option( $opt, $new );
			foreach ( $changes as $c ) {
				$rollback[] = array( 'kind' => 'option', 'option' => $opt, 'path' => $c[0], 'before' => $c[1], 'after' => $c[2] );
				legacy_copy_v4_hits_into( $tally, $c[3], array( 'kind' => 'option', 'option' => $opt, 'path' => implode( '.', $c[0] ) ) );
			}
		}
	}

	/* 3. Attachments: "Revenie" anywhere in alt/title/caption/description; "personalized" alt/title. */
	$revenie = array();
	foreach ( (array) get_posts( array( 'post_type' => 'attachment', 'post_status' => 'inherit', 'posts_per_page' => -1, 'fields' => 'ids', 'no_found_rows' => true, 'suppress_filters' => true,
		'meta_query' => array( array( 'key' => '_wp_attachment_image_alt', 'value' => 'Revenie', 'compare' => 'LIKE' ) ) ) ) as $id ) {
		$revenie[ (int) $id ] = true;
	}
	foreach ( (array) get_posts( array( 'post_type' => 'attachment', 'post_status' => 'inherit', 'posts_per_page' => -1, 'fields' => 'ids', 'no_found_rows' => true, 'suppress_filters' => true, 's' => 'Revenie' ) ) as $id ) {
		$revenie[ (int) $id ] = true;
	}
	$typo_rules = array_values( array_filter( $rules, function ( $r ) { return 'revenue-typo' === $r['id']; } ) );
	foreach ( array_keys( $revenie ) as $aid ) {
		$cur = get_post_meta( $aid, '_wp_attachment_image_alt', true );
		if ( is_string( $cur ) && '' !== $cur ) {
			list( $new, $hits ) = legacy_copy_v4_apply_rules( $cur, $typo_rules );
			if ( $hits && $new !== $cur ) {
				update_post_meta( $aid, '_wp_attachment_image_alt', wp_slash( $new ) );
				$rollback[] = array( 'kind' => 'meta', 'post' => $aid, 'key' => '_wp_attachment_image_alt', 'before' => $cur, 'after' => $new );
				legacy_copy_v4_hits_into( $tally, $hits, array( 'kind' => 'attachment-alt', 'post' => $aid ) );
			}
		}
		$post = get_post( $aid );
		foreach ( array( 'post_title', 'post_excerpt', 'post_content' ) as $field ) {
			$cur = $post ? (string) $post->$field : '';
			if ( '' === $cur ) {
				continue;
			}
			list( $new, $hits ) = legacy_copy_v4_apply_rules( $cur, $typo_rules );
			if ( $hits && $new !== $cur && ! legacy_copy_v4_failed( legacy_copy_v4_update_post_field( $aid, $field, $new ) ) ) {
				$rollback[] = array( 'kind' => 'post_field', 'post' => $aid, 'field' => $field, 'before' => $cur, 'after' => $new );
				legacy_copy_v4_hits_into( $tally, $hits, array( 'kind' => 'attachment-' . $field, 'post' => $aid ) );
			}
		}
	}
	foreach ( (array) get_posts( array( 'post_type' => 'attachment', 'post_status' => 'inherit', 'posts_per_page' => -1, 'fields' => 'ids', 'no_found_rows' => true, 'suppress_filters' => true,
		'meta_query' => array( array( 'key' => '_wp_attachment_image_alt', 'value' => 'personalized', 'compare' => '=' ) ) ) ) as $id ) {
		$images[ (int) $id ] = true;
	}
	foreach ( (array) get_posts( array( 'post_type' => 'attachment', 'post_status' => 'inherit', 'posts_per_page' => -1, 'fields' => 'ids', 'no_found_rows' => true, 'suppress_filters' => true, 'title' => 'personalized' ) ) as $id ) {
		$images[ (int) $id ] = true;
	}
	ksort( $images );
	foreach ( array_keys( $images ) as $aid ) {
		$alt = get_post_meta( $aid, '_wp_attachment_image_alt', true );
		if ( legacy_copy_v4_is_personalized( $alt ) ) {
			update_post_meta( $aid, '_wp_attachment_image_alt', wp_slash( LEGACY_COPY_V4_ALT_TEXT ) );
			$rollback[] = array( 'kind' => 'meta', 'post' => $aid, 'key' => '_wp_attachment_image_alt', 'before' => $alt, 'after' => LEGACY_COPY_V4_ALT_TEXT );
			legacy_copy_v4_hits_into( $tally, array( 'store-sites-alt' => 1 ), array( 'kind' => 'attachment-alt', 'post' => $aid ) );
		}
		$post  = get_post( $aid );
		$title = $post ? (string) $post->post_title : '';
		if ( legacy_copy_v4_is_personalized( $title ) && ! legacy_copy_v4_failed( legacy_copy_v4_update_post_field( $aid, 'post_title', LEGACY_COPY_V4_ALT_TEXT ) ) ) {
			$rollback[] = array( 'kind' => 'post_field', 'post' => $aid, 'field' => 'post_title', 'before' => $title, 'after' => LEGACY_COPY_V4_ALT_TEXT );
			legacy_copy_v4_hits_into( $tally, array( 'store-sites-alt' => 1 ), array( 'kind' => 'attachment-post_title', 'post' => $aid ) );
		}
	}

	/* 4. Run result: every rule, changed (with where) or skipped. */
	$results = array();
	$ids     = array_merge( array_column( $rules, 'id' ), array( 'store-sites-alt' ) );
	foreach ( $ids as $rid ) {
		if ( ! empty( $tally[ $rid ] ) ) {
			$results[] = array( 'rule' => $rid, 'status' => 'changed', 'count' => array_sum( array_column( $tally[ $rid ], 'count' ) ), 'where' => $tally[ $rid ] );
		} else {
			$results[] = array( 'rule' => $rid, 'status' => 'skipped', 'reason' => 'not found (already fixed, or the copy moved)' );
		}
	}
	update_option( LEGACY_COPY_V4_ROLLBACK_OPTION, $rollback, false );
	update_option(
		LEGACY_COPY_V4_DONE_OPTION,
		array(
			'ran_at'  => gmdate( 'c' ),
			'posts'   => count( $posts ),
			'changed' => count( array_filter( $results, function ( $r ) { return 'changed' === $r['status']; } ) ),
			'skipped' => count( array_filter( $results, function ( $r ) { return 'skipped' === $r['status']; } ) ),
			'values'  => count( $rollback ),
			'results' => $results,
			'residue' => $residue,
		),
		false
	);
	delete_option( LEGACY_COPY_V4_LOCK_OPTION );
}

function legacy_copy_v4_failed( $r ) {
	return ( function_exists( 'is_wp_error' ) && is_wp_error( $r ) ) || false === $r || 0 === $r;
}

/** Put every value still equal to its "after" back to its exact "before". */
function legacy_copy_v4_rollback() {
	$entries  = get_option( LEGACY_COPY_V4_ROLLBACK_OPTION );
	$restored = 0;
	$conflict = array();
	if ( ! is_array( $entries ) ) {
		return array( 'restored' => 0, 'conflicts' => array() );
	}
	$by_post = array();
	foreach ( $entries as $e ) {
		if ( 'elementor' === $e['kind'] ) {
			$by_post[ $e['post'] ][] = $e;
		}
	}
	foreach ( $by_post as $post_id => $list ) {
		$data = legacy_copy_v4_decode( get_post_meta( $post_id, '_elementor_data', true ) );
		if ( null === $data ) {
			foreach ( $list as $e ) {
				$conflict[] = array( 'kind' => 'elementor', 'post' => $post_id, 'path' => implode( '.', $e['path'] ) );
			}
			continue;
		}
		$changed = false;
		foreach ( array_reverse( $list ) as $e ) {
			if ( legacy_copy_v4_get_at( $data, $e['path'] ) === $e['after'] && legacy_copy_v4_set_at( $data, $e['path'], $e['before'] ) ) {
				$restored++;
				$changed = true;
			} else {
				$conflict[] = array( 'kind' => 'elementor', 'post' => $post_id, 'path' => implode( '.', $e['path'] ) );
			}
		}
		if ( $changed ) {
			legacy_copy_v4_save_elementor( $post_id, $data );
		}
	}
	$options = array();
	foreach ( array_reverse( $entries ) as $e ) {
		if ( 'meta' === $e['kind'] ) {
			if ( get_post_meta( $e['post'], $e['key'], true ) === $e['after'] ) {
				update_post_meta( $e['post'], $e['key'], wp_slash( $e['before'] ) );
				$restored++;
			} else {
				$conflict[] = array( 'kind' => 'meta', 'post' => $e['post'], 'key' => $e['key'] );
			}
		} elseif ( 'post_field' === $e['kind'] ) {
			$post = get_post( $e['post'] );
			if ( $post && (string) $post->{$e['field']} === $e['after'] && ! legacy_copy_v4_failed( legacy_copy_v4_update_post_field( $e['post'], $e['field'], $e['before'] ) ) ) {
				$restored++;
			} else {
				$conflict[] = array( 'kind' => 'post_field', 'post' => $e['post'], 'field' => $e['field'] );
			}
		} elseif ( 'option' === $e['kind'] ) {
			if ( ! array_key_exists( $e['option'], $options ) ) {
				$options[ $e['option'] ] = get_option( $e['option'] );
			}
			if ( is_array( $options[ $e['option'] ] ) && legacy_copy_v4_get_at( $options[ $e['option'] ], $e['path'] ) === $e['after'] && legacy_copy_v4_set_at( $options[ $e['option'] ], $e['path'], $e['before'] ) ) {
				$restored++;
			} else {
				$conflict[] = array( 'kind' => 'option', 'option' => $e['option'], 'path' => implode( '.', $e['path'] ) );
			}
		}
	}
	foreach ( $options as $name => $value ) {
		update_option( $name, $value );
	}
	return array( 'restored' => $restored, 'conflicts' => $conflict );
}

function legacy_copy_v4_maybe_rollback() {
	if ( ! get_option( LEGACY_COPY_V4_RB_REQUEST_OPTION ) ) {
		return;
	}
	if ( ! delete_option( LEGACY_COPY_V4_RB_REQUEST_OPTION ) ) {
		return; // another request took it.
	}
	$r = legacy_copy_v4_rollback();
	update_option( LEGACY_COPY_V4_RB_RESULT_OPTION, $r + array( 'ran_at' => gmdate( 'c' ) ), false );
}

if ( function_exists( 'add_action' ) && ! defined( 'PH_LEGACY_COPY_TEST' ) ) {
	add_action( 'init', __NAMESPACE__ . '\legacy_copy_v4_maybe_rollback', 24 );
	add_action( 'init', __NAMESPACE__ . '\legacy_copy_v4_run', 25 );
}
