<?php
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_LEGACY_COPY_TEST' ) ) {
	exit;
}

/*
 * Third one-time content migration (6 Nov 2026): retries the 11 v2 targets that were skipped because
 * their `find` contains an en dash. WordPress stores " - " and wptexturize renders " – ", so the v2
 * matcher missed them; legacy_copy_v2_pattern() now lets a dash token also match ---, -- and -.
 * Reuses the v2 helpers (pattern, replace, apply_target, migrate_data, clear_caches). Own options:
 * ph_legacy_copy_v3, ph_legacy_copy_v3_lock, ph_legacy_copy_v3_rollback. Runs once on init (priority 22)
 * behind an atomic add_option lock. Several targets hit one setting (04f25c2, 05e18ed); applied in order.
 */

const LEGACY_COPY_V3_DONE_OPTION     = 'ph_legacy_copy_v3';
const LEGACY_COPY_V3_LOCK_OPTION     = 'ph_legacy_copy_v3_lock';
const LEGACY_COPY_V3_ROLLBACK_OPTION = 'ph_legacy_copy_v3_rollback';

function legacy_copy_v3_targets() {
	return array(
		array( 'post' => 2389, 'element' => '1971c5d', 'setting' => 'editor',
			'marker' => 'Amazon Bedrock, or your own custom models',
			'find' => 'The platform transforms the campaign creation workflow by enabling marketing teams to leverage the best-available AI models at every stage – whether that’s using OpenAI, Gemini, Anthropic, Amazon Bedrock, or your own custom models – each decision is powered by the right intelligence for the right task.',
			'replace' => 'The platform transforms the campaign creation workflow with a model-agnostic AI harness that uses the best available models to take every campaign from brief through to creative. Leading providers are simply the defaults it is first optimised for – switch to any model, including your own, as models evolve.' ),
		array( 'post' => 2389, 'element' => '04f25c2', 'setting' => 'editor',
			'marker' => 'enterprise-ready media player purpose-built for commercial digital signage',
			'find' => 'Amazon Signage Stick is an affordable, enterprise-ready media player purpose-built for commercial digital signage – delivering reliable 4K playback at a fraction of the cost of traditional hardware.',
			'replace' => 'The Personalisation Hub player is a progressive web app (PWA) that runs on any digital signage hardware – and is easily extended to the players already in your stores.' ),
		array( 'post' => 2389, 'element' => '04f25c2', 'setting' => 'editor',
			'marker' => 'Personalisation Hub comes preloaded on Amazon Signage Stick, giving retailers an immediate path',
			'find' => 'Personalisation Hub comes preloaded on Amazon Signage Stick, giving retailers an immediate path to data-driven, personalised in-store experiences – at any scale, from a single store to a national network.',
			'replace' => 'It runs on Amazon Signage, Fire TV, ChromeOS, Android and other players, giving retailers an immediate path to data-driven, personalised in-store experiences – at any scale, from a single store to a national network.' ),
		array( 'post' => 2389, 'element' => '04f25c2', 'setting' => 'editor',
			'marker' => 'As the only Amazon Signage CMS partner built from the ground up for retail personalisation, ',
			'find' => 'As the only Amazon Signage CMS partner built from the ground up for retail personalisation, Personalisation Hub runs entirely within your own AWS Virtual Private Cloud – on your domain, your data and your security controls. No shared infrastructure.',
			'replace' => 'As an Amazon Signage CMS partner built from the ground up for retail personalisation, Personalisation Hub runs entirely within your own AWS Virtual Private Cloud – on your domain, your data and your security controls. No shared infrastructure.' ),
		array( 'post' => 7020, 'element' => '16ba2fa', 'setting' => 'editor',
			'marker' => 'Personalisation Hub identifies your customers the moment they arrive',
			'find' => 'Personalisation Hub identifies your customers the moment they arrive – and personalises every screen, every offer and every interaction.',
			'replace' => 'Personalisation Hub checks customers in the moment they arrive – by queue, appointment, QR, proximity or your own check-in – and personalises every screen, every offer and every interaction.' ),
		array( 'post' => 7020, 'element' => 'dc3b52e', 'setting' => 'editor',
			'marker' => 'OpenAI, Gemini, Anthropic, Amazon Bedrock, or your own.',
			'find' => 'The platform continuously monitors campaign performance and automatically adjusts content to maximise conversion – using whichever AI model delivers the best results: OpenAI, Gemini, Anthropic, Amazon Bedrock, or your own.',
			'replace' => 'The platform analyses how every campaign performs and optimises its next version to drive more revenue – through a model-agnostic AI harness. Leading models are the defaults; switch to any model, including your own, as models evolve.' ),
		array( 'post' => 7020, 'element' => '05e18ed', 'setting' => 'editor',
			'marker' => 'enterprise-ready media player purpose-built for commercial digital signage',
			'find' => 'Amazon Signage Stick is an affordable, enterprise-ready media player purpose-built for commercial digital signage – delivering reliable 4K playback at a fraction of the cost of traditional hardware.',
			'replace' => 'The Personalisation Hub player is a progressive web app (PWA) that runs on any digital signage hardware – and is easily extended to the players already in your stores.' ),
		array( 'post' => 7020, 'element' => '05e18ed', 'setting' => 'editor',
			'marker' => 'Personalisation Hub comes preloaded on Amazon Signage Stick, giving retailers an immediate path',
			'find' => 'Personalisation Hub comes preloaded on Amazon Signage Stick, giving retailers an immediate path to data-driven, personalised in-store experiences – at any scale, from a single store to a national network.',
			'replace' => 'It runs on Amazon Signage, Fire TV, ChromeOS, Android and other players, giving retailers an immediate path to data-driven, personalised in-store experiences – at any scale, from a single store to a national network.' ),
		array( 'post' => 7020, 'element' => '05e18ed', 'setting' => 'editor',
			'marker' => 'As the only Amazon Signage CMS partner built from the ground up for retail personalisation, ',
			'find' => 'As the only Amazon Signage CMS partner built from the ground up for retail personalisation, Personalisation Hub runs entirely within your own AWS Virtual Private Cloud – on your domain, your data and your security controls. No shared infrastructure.',
			'replace' => 'As an Amazon Signage CMS partner built from the ground up for retail personalisation, Personalisation Hub runs entirely within your own AWS Virtual Private Cloud – on your domain, your data and your security controls. No shared infrastructure.' ),
		array( 'post' => 7020, 'element' => '55cf36c', 'setting' => 'editor',
			'marker' => 'Target campaigns to individual customer segments across your in-store screens',
			'find' => 'Target campaigns to individual customer segments across your in-store screens – and prove the ROI to every advertiser.',
			'replace' => 'Use your first-party and loyalty data to target advertiser campaigns on in-store screens, lift conversion on offers in the aisle and at the point of sale – and prove the ROI to every advertiser.' ),
		array( 'post' => 8877, 'element' => 'b73c3a9', 'setting' => 'editor',
			'marker' => 'The AI optimisation loop continuously refines creative, scheduling and targeting',
			'find' => 'The AI optimisation loop continuously refines creative, scheduling and targeting – without anyone lifting a finger.',
			'replace' => 'The closed loop analyses each campaign’s performance and optimises its next version – creative, scheduling and targeting – to drive more revenue, without anyone lifting a finger.' ),
	);
}

function legacy_copy_v3_run() {
	if ( get_option( LEGACY_COPY_V3_DONE_OPTION ) ) {
		return;
	}
	// add_option fails when the row exists: atomic, so two requests cannot both run the migration.
	if ( ! add_option( LEGACY_COPY_V3_LOCK_OPTION, (string) time(), '', 'no' ) ) {
		return;
	}
	$all     = array();
	$by_post = array();
	foreach ( legacy_copy_v3_targets() as $t ) {
		$by_post[ $t['post'] ][] = $t;
	}
	foreach ( $by_post as $post_id => $targets ) {
		$raw  = get_post_meta( $post_id, '_elementor_data', true );
		$data = is_string( $raw ) ? json_decode( $raw, true ) : $raw;
		if ( ! is_array( $data ) ) {
			foreach ( $targets as $t ) {
				$all[] = array( 'post' => $post_id, 'element' => $t['element'], 'setting' => $t['setting'], 'status' => 'missing', 'before' => '', 'after' => '' );
			}
			continue;
		}
		list( $data, $results, $changed ) = legacy_copy_v2_migrate_data( $data, $targets );
		if ( $changed ) {
			update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $data ) ) );
			legacy_copy_v2_clear_caches( $post_id );
		}
		$all = array_merge( $all, $results );
	}
	update_option( LEGACY_COPY_V3_ROLLBACK_OPTION, $all, false );
	update_option(
		LEGACY_COPY_V3_DONE_OPTION,
		array(
			'ran_at'  => gmdate( 'c' ),
			'changed' => count( array_filter( $all, function ( $r ) { return 'changed' === $r['status']; } ) ),
			'skipped' => count( array_filter( $all, function ( $r ) { return 'skipped' === $r['status']; } ) ),
			'missing' => count( array_filter( $all, function ( $r ) { return 'missing' === $r['status']; } ) ),
		),
		false
	);
	delete_option( LEGACY_COPY_V3_LOCK_OPTION );
}

if ( function_exists( 'add_action' ) && ! defined( 'PH_LEGACY_COPY_TEST' ) ) {
	add_action( 'init', __NAMESPACE__ . '\legacy_copy_v3_run', 22 );
}
