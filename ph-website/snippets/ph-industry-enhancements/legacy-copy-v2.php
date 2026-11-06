<?php
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_LEGACY_COPY_TEST' ) ) {
	exit;
}

/*
 * Second one-time content migration (5 Nov 2026) for Elementor V3 widgets the Elementor MCP cannot
 * edit: the website accuracy pass (no Kafka/MSK, extensible store check-in, model-agnostic AI harness,
 * any-player PWA, industry-agnostic positioning, retail media led by first-party data). Same shape as
 * legacy-copy.php (v1): runs once on init, atomic lock row, per-post _elementor_data read-modify-write.
 *
 * Differences from v1: each target is { post, element, setting, marker, find, replace } and swaps
 * `find` for `replace` INSIDE the current value (several targets may hit one setting; applied in order).
 * `setting` may be a dotted repeater path such as features_list.0.item_text. `find` was read from the
 * rendered page, so if it is not found exactly it is matched with typography normalised (curly and
 * straight quotes, dashes, &nbsp;/space, &amp;/&). A target is applied only when exactly one match
 * exists and the element still contains `marker` (same normalisation); otherwise it is "skipped".
 * Before/after values and the run result are stored in options for rollback.
 */

const LEGACY_COPY_V2_DONE_OPTION     = 'ph_legacy_copy_v2';
const LEGACY_COPY_V2_LOCK_OPTION     = 'ph_legacy_copy_v2_lock';
const LEGACY_COPY_V2_ROLLBACK_OPTION = 'ph_legacy_copy_v2_rollback';

function legacy_copy_v2_targets() {
	return array(
		array( 'post' => 2389, 'element' => '1971c5d', 'setting' => 'editor',
			'marker' => 'Amazon Bedrock, or your own custom models',
			'find' => 'The platform transforms the campaign creation workflow by enabling marketing teams to leverage the best-available AI models at every stage – whether that’s using OpenAI, Gemini, Anthropic, Amazon Bedrock, or your own custom models – each decision is powered by the right intelligence for the right task.',
			'replace' => 'The platform transforms the campaign creation workflow with a model-agnostic AI harness that uses the best available models to take every campaign from brief through to creative. Leading providers are simply the defaults it is first optimised for – switch to any model, including your own, as models evolve.' ),
		array( 'post' => 2389, 'element' => '1971c5d', 'setting' => 'editor',
			'marker' => 'In physical retail, visitors are identified the moment they arrive, enabling real-time personalisation throughout the in-store experience.',
			'find' => 'In physical retail, visitors are identified the moment they arrive, enabling real-time personalisation throughout the in-store experience.',
			'replace' => 'In physical retail, visitors are identified when they check in – by queue, appointment, click-and-collect, QR, proximity or your own check-in mechanism – enabling real-time personalisation throughout the in-store experience.' ),
		array( 'post' => 2389, 'element' => '03303da', 'setting' => 'editor',
			'marker' => 'Ability to track every impression, interaction, and conversion across all touchpoints, including in-store.',
			'find' => 'Ability to track every impression, interaction, and conversion across all touchpoints, including in-store.',
			'replace' => 'Full visibility of every store, fed into your own analytics for a complete 360° view – so attribution now includes in-store transactions.' ),
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
		array( 'post' => 2389, 'element' => '04f25c2', 'setting' => 'editor',
			'marker' => 'href="https://personalisationhub.com/amazon-signage/"',
			'find' => 'href="https://personalisationhub.com/amazon-signage/"',
			'replace' => 'href="https://personalisationhub.com/digital-signage/"' ),
		array( 'post' => 2389, 'element' => '1253f65', 'setting' => 'editor',
			'marker' => 'It runs entirely inside your own AWS environment and reads what',
			'find' => 'It runs entirely inside your own AWS environment and reads what’s happening in each store right now. It then shows every shopper a relevant ad at the shelf edge, so each slot is worth more.',
			'replace' => 'It uses your first-party and loyalty data, and what’s happening in each store right now, to target advertiser campaigns in store and lift conversion on offers in the aisle and at the point of sale, so each slot is worth more.' ),
		array( 'post' => 2389, 'element' => 'ec1802e', 'setting' => 'features_list.0.item_text',
			'marker' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'find' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'replace' => 'Extensible Store Check-In (Queue, Appointments, Click & Collect, QR, Proximity)' ),
		array( 'post' => 3566, 'element' => '91e2463', 'setting' => 'features_list.0.item_text',
			'marker' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'find' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'replace' => 'Extensible Store Check-In (Queue, Appointments, Click & Collect, QR, Proximity)' ),
		array( 'post' => 7020, 'element' => 'bc284a2', 'setting' => 'features_list.0.item_text',
			'marker' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'find' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'replace' => 'Extensible Store Check-In (Queue, Appointments, Click & Collect, QR, Proximity)' ),
		array( 'post' => 3973, 'element' => '4f48510', 'setting' => 'features_list.0.item_text',
			'marker' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'find' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'replace' => 'Extensible Store Check-In (Queue, Appointments, Click & Collect, QR, Proximity)' ),
		array( 'post' => 3266, 'element' => 'acfeb32', 'setting' => 'features_list.0.item_text',
			'marker' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'find' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'replace' => 'Extensible Store Check-In (Queue, Appointments, Click & Collect, QR, Proximity)' ),
		array( 'post' => 6254, 'element' => 'a18fa18', 'setting' => 'features_list.0.item_text',
			'marker' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'find' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'replace' => 'Extensible Store Check-In (Queue, Appointments, Click & Collect, QR, Proximity)' ),
		array( 'post' => 3477, 'element' => '39f2fac', 'setting' => 'features_list.0.item_text',
			'marker' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'find' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'replace' => 'Extensible Store Check-In (Queue, Appointments, Click & Collect, QR, Proximity)' ),
		array( 'post' => 2711, 'element' => '9976489', 'setting' => 'features_list.0.item_text',
			'marker' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'find' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'replace' => 'Extensible Store Check-In (Queue, Appointments, Click & Collect, QR, Proximity)' ),
		array( 'post' => 3035, 'element' => 'ce7734a', 'setting' => 'features_list.0.item_text',
			'marker' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'find' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'replace' => 'Extensible Store Check-In (Queue, Appointments, Click & Collect, QR, Proximity)' ),
		array( 'post' => 8877, 'element' => '83a462e', 'setting' => 'features_list.0.item_text',
			'marker' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'find' => 'Store Visitor Check-In (Virtual Queue Management, Appointments, Proximity)',
			'replace' => 'Extensible Store Check-In (Queue, Appointments, Click & Collect, QR, Proximity)' ),
		array( 'post' => 3566, 'element' => '16ba2fa', 'setting' => 'editor',
			'marker' => 'Imagine recognising a loyalty customer as they walk into a store and instantly tailoring digital signage, kiosks, or mobile content to them.',
			'find' => 'Imagine recognising a loyalty customer as they walk into a store and instantly tailoring digital signage, kiosks, or mobile content to them.',
			'replace' => 'Imagine a loyalty customer checking in as they walk into a store – by queue, appointment, QR or proximity – and digital signage, kiosks or mobile content adapting to them instantly.' ),
		array( 'post' => 3566, 'element' => 'a3d61a2', 'setting' => 'editor',
			'marker' => 'The system autonomously optimises content, campaign timing and targeting (closed-loop optimisation) without the need for manual rules.',
			'find' => 'The system autonomously optimises content, campaign timing and targeting (closed-loop optimisation) without the need for manual rules.',
			'replace' => 'The closed loop analyses how each campaign performs and optimises its next version – content, timing and targeting – so it drives more revenue, without manual rules.' ),
		array( 'post' => 3566, 'element' => 'a3d61a2', 'setting' => 'editor',
			'marker' => 'With integrated generative AI, marketers can instantly create',
			'find' => 'With integrated generative AI, marketers can instantly create',
			'replace' => 'With a model-agnostic generative AI harness, marketers can instantly create' ),
		array( 'post' => 3566, 'element' => 'f8aa2f0', 'setting' => 'editor',
			'marker' => 'Embed the (Context-Aware) Store-Sites into your Mobile-App to Seamlessly Leverage Customer Data as they walk past/through Your Retail Store.',
			'find' => 'Embed the (Context-Aware) Store-Sites into your Mobile-App to Seamlessly Leverage Customer Data as they walk past/through Your Retail Store.',
			'replace' => 'Check Customers In on Arrival (Queue, Appointment, Click &amp; Collect, QR, Proximity or Your Own Check-In via the Visitor API) to Seamlessly Leverage Customer Data as they walk past/through Your Retail Store.' ),
		array( 'post' => 7020, 'element' => '16ba2fa', 'setting' => 'editor',
			'marker' => 'Personalisation Hub identifies your customers the moment they arrive',
			'find' => 'Personalisation Hub identifies your customers the moment they arrive – and personalises every screen, every offer and every interaction.',
			'replace' => 'Personalisation Hub checks customers in the moment they arrive – by queue, appointment, QR, proximity or your own check-in – and personalises every screen, every offer and every interaction.' ),
		array( 'post' => 7020, 'element' => '478f953', 'setting' => 'title_text',
			'marker' => 'Personalised versus Programmatic',
			'find' => 'Personalised versus Programmatic',
			'replace' => 'Personalised Retail Media' ),
		array( 'post' => 7020, 'element' => '478f953', 'setting' => 'description_text',
			'marker' => 'Full control over Ad slot inventory, control whether to present own versus paid campaigns, ensuring maximum relevance.',
			'find' => 'Full control over Ad slot inventory, control whether to present own versus paid campaigns, ensuring maximum relevance.',
			'replace' => 'Full control over ad slot inventory: choose whether each slot plays your own or paid campaigns.' ),
		array( 'post' => 7020, 'element' => '478f953', 'setting' => 'description_text',
			'marker' => 'Unlock previously inaccessible demand and let third-party advertisers bid dynamically.',
			'find' => 'Unlock previously inaccessible demand and let third-party advertisers bid dynamically.',
			'replace' => 'Use your first-party and loyalty data to target advertiser campaigns and lift conversion on offers in the aisle and at the point of sale.' ),
		array( 'post' => 7020, 'element' => '8fa8f98', 'setting' => 'editor',
			'marker' => 'in real time, based on your own first-party customer data.',
			'find' => 'in real time, based on your own first-party customer data.</p>',
			'replace' => 'in real time, based on your own first-party customer data. Computer vision at the edge targets and optimises creative in real time – age and gender by default, or custom models built with you.</p>' ),
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
		array( 'post' => 3973, 'element' => '4725a31', 'setting' => 'editor',
			'marker' => 'Automatically target audiences by demographics, lifestyle and local target audience data.',
			'find' => 'Automatically target audiences by demographics, lifestyle and local target audience data.',
			'replace' => 'Store segments group stores by mostly stable attributes, such as demographics or metro, regional and airport locations, so campaigns localise automatically.' ),
		array( 'post' => 3973, 'element' => 'f394b60', 'setting' => 'description_text',
			'marker' => 'Ensuring Brands always have Accurate Retail Data that gets used as the Driving Force behind their Campaign Localisation Efforts',
			'find' => 'Ensuring Brands always have Accurate Retail Data that gets used as the Driving Force behind their Campaign Localisation Efforts',
			'replace' => 'A Digital Twin of every Store drives Dynamic Campaign Localisation, and Store Data syncs with Google Business so Customers always see Accurate Details' ),
		array( 'post' => 3973, 'element' => 'aa486d8', 'setting' => 'editor',
			'marker' => 'Ensure Retail Data is always accurate, so that a Buyer',
			'find' => 'Ensure Retail Data is always accurate, so that a Buyer’s Shopping Experience from Google starts off well.',
			'replace' => 'Sync Store Data with Google Business, so Buyers always get accurate information on Google Maps and connected mapping platforms.' ),
		array( 'post' => 3266, 'element' => '16ba2fa', 'setting' => 'editor',
			'marker' => 'Our platform empowers retailers to create world-leading in-store experiences that seamlessly connect digital and physical touchpoints, allowing advertisers to reach real buyers in meaningful moments.',
			'find' => 'Our platform empowers retailers to create world-leading in-store experiences that seamlessly connect digital and physical touchpoints, allowing advertisers to reach real buyers in meaningful moments.',
			'replace' => 'Our platform lets retailers use their own first-party and loyalty data to target advertiser campaigns in store, and to lift conversion on offers surfaced in the aisle and at the point of sale.' ),
		array( 'post' => 3266, 'element' => 'b9bb6fa', 'setting' => 'editor',
			'marker' => 'Overlay customer, loyalty and store-interaction data to personalise every campaign.',
			'find' => 'Overlay customer, loyalty and store-interaction data to personalise every campaign.',
			'replace' => 'Use your customer and loyalty data to target advertiser campaigns in store and lift conversion on offers in the aisle and at the point of sale.' ),
		array( 'post' => 3266, 'element' => 'c669a16', 'setting' => 'description_text',
			'marker' => 'Runs inside your own (VPC) cloud for total data ownership and compliance. Securely activates loyalty and customer data without ever leaving your environment.',
			'find' => 'Runs inside your own (VPC) cloud for total data ownership and compliance. Securely activates loyalty and customer data without ever leaving your environment.',
			'replace' => 'Target advertiser campaigns in store with your own loyalty and customer data, activated inside your own (VPC) cloud so it never leaves your environment.' ),
		array( 'post' => 6254, 'element' => '82a9161', 'setting' => 'description_text',
			'marker' => 'Designed to work with any leading AI model or agent, including OpenAI, Anthropic, Gemini, and LLaMA.',
			'find' => 'Designed to work with any leading AI model or agent, including OpenAI, Anthropic, Gemini, and LLaMA.',
			'replace' => 'A model-agnostic harness uses the best available models from brief to creative. Leading providers are only the defaults; use any model, including your own.' ),
		array( 'post' => 6254, 'element' => 'df9bd7b', 'setting' => 'description_text',
			'marker' => 'Integrates physical-store data sources (store cameras, sensors, Wi-Fi systems like Mist, data platforms such as BigQuery, Pega, and Cloudera) to create a real-time digital representation of each store.',
			'find' => 'Integrates physical-store data sources (store cameras, sensors, Wi-Fi systems like Mist, data platforms such as BigQuery, Pega, and Cloudera) to create a real-time digital representation of each store.',
			'replace' => 'Creates a digital twin of every store from its store data, cameras and sensors (e.g. Mist Wi-Fi) for dynamic campaign localisation, and syncs store data with Google Business for accurate Google Maps listings.' ),
		array( 'post' => 3477, 'element' => 'b9bb6fa', 'setting' => 'editor',
			'marker' => 'Integrate Store-Sites into Your Mobile App to seamlessly leverage any Customer Data',
			'find' => 'Integrate Store-Sites into Your Mobile App to seamlessly leverage any Customer Data to Personalise Customer’s Retail Experiences as they walk past/through Your Stores.',
			'replace' => 'Once Customers Check In, by QR Code, Queue, Appointment, Proximity or Your Own Check-In, Store-Sites leverage any Customer Data to Personalise their Retail Experience as they walk past/through Your Stores.' ),
		array( 'post' => 3477, 'element' => 'e9f16bb', 'setting' => 'editor',
			'marker' => 'Customers have several Options to Check-In to your Store (Beacons, QR Codes, etc) on Arrival.',
			'find' => 'Customers have several Options to Check-In to your Store (Beacons, QR Codes, etc) on Arrival.',
			'replace' => 'Customers Check-In to your Store on Arrival using built-in Options (QR Codes, Queues, Appointments, Click &amp; Collect, Proximity) or Your Own, added via the Visitor API.' ),
		array( 'post' => 2711, 'element' => '16ba2fa', 'setting' => 'editor',
			'marker' => 'A virtual queue is one of the ways Personalisation Hub checks customers in when they arrive in store, alongside appointments, click-and-collect appointments and proximity. New check-in methods keep being added.',
			'find' => 'A virtual queue is one of the ways Personalisation Hub checks customers in when they arrive in store, alongside appointments, click-and-collect appointments and proximity. New check-in methods keep being added.',
			'replace' => 'A virtual queue is one of the ways Personalisation Hub checks customers in when they arrive in store, alongside appointments, click-and-collect, store sites, QR and proximity. You can also add your own check-in methods through the Visitor API and customisable edge models.' ),
		array( 'post' => 2711, 'element' => '8fa8f98', 'setting' => 'editor',
			'marker' => 'Booking an appointment, arriving for a click-and-collect pickup or being recognised by proximity are others, and the list keeps growing.',
			'find' => 'Booking an appointment, arriving for a click-and-collect pickup or being recognised by proximity are others, and the list keeps growing.',
			'replace' => 'Booking an appointment, arriving for a click-and-collect pickup, scanning a QR code or being recognised by proximity are others, and you can add your own through the Visitor API and edge models.' ),
		array( 'post' => 2711, 'element' => '5101d47', 'setting' => 'title',
			'marker' => '3. Full Visibility via Staff Tablet',
			'find' => '3. Full Visibility via Staff Tablet',
			'replace' => '3. Full Visibility via Retail Admin' ),
		array( 'post' => 2711, 'element' => '9596cc0', 'setting' => 'editor',
			'marker' => 'Provide Retail Staff with Full Visibility over their Current Queue (wait vs serve times) to ensure Visitors experience the best possible customer service.',
			'find' => 'Provide Retail Staff with Full Visibility over their Current Queue (wait vs serve times) to ensure Visitors experience the best possible customer service.',
			'replace' => 'Every Store and Staff Member gets Retail Admin on the staff tablet, with Admin, Manager and Staff roles and a personal login, giving Full Visibility over their Store’s Queue (wait vs serve times).' ),
		array( 'post' => 3035, 'element' => '8fa8f98', 'setting' => 'editor',
			'marker' => 'Personalise their Mobile App Experience based on what aisle/section they are standing-in',
			'find' => 'Personalise their Mobile App Experience based on what aisle/section they are standing-in',
			'replace' => 'Personalise their Mobile Store Site based on what aisle/section they are standing-in' ),
		array( 'post' => 8877, 'element' => '75a5a19', 'setting' => 'editor',
			'marker' => 'Personalisation Hub comes preloaded on Amazon Signage Stick, allowing retailers to seamlessly support data-driven, personalised experiences to store visitors at scale.',
			'find' => 'Personalisation Hub comes preloaded on Amazon Signage Stick, allowing retailers to seamlessly support data-driven, personalised experiences to store visitors at scale.',
			'replace' => 'Personalisation Hub comes preloaded on Amazon Signage Stick, allowing retailers to support data-driven, personalised experiences at scale – and the same player runs on any other signage hardware in your estate.' ),
		array( 'post' => 8877, 'element' => '3515df0', 'setting' => 'editor',
			'marker' => 'Visitors are identified the moment they arrive in-store.',
			'find' => 'Visitors are identified the moment they arrive in-store.',
			'replace' => 'Visitors are identified as they check in – by queue, appointment, QR, proximity or your own check-in.' ),
		array( 'post' => 8877, 'element' => '1bb3c4e', 'setting' => 'description_text',
			'marker' => 'Visitors are identified the moment they arrive in-store, enabling real-time personalisation on digital-signage, at shelf-edge all the way to point of sale and beyond.',
			'find' => 'Visitors are identified the moment they arrive in-store, enabling real-time personalisation on digital-signage, at shelf-edge all the way to point of sale and beyond.',
			'replace' => 'Visitors are identified as they check in, enabling real-time personalisation on digital signage, at the shelf edge, all the way to point of sale and beyond.' ),
		array( 'post' => 8877, 'element' => 'd6abd7a', 'setting' => 'title_text',
			'marker' => 'AI-Powered Campaign Creation via Amazon Bedrock',
			'find' => 'AI-Powered Campaign Creation via Amazon Bedrock',
			'replace' => 'Model-Agnostic AI Campaign Creation' ),
		array( 'post' => 8877, 'element' => 'd6abd7a', 'setting' => 'description_text',
			'marker' => 'Leverage the best-available AI model at every stage of the campaign creation process',
			'find' => 'Leverage the best-available AI model at every stage of the campaign creation process - Leverage best models for planning and optimisation, best available GenAI models for creative generation, or your own custom models - so each decision is powered by the right intelligence for the right task.',
			'replace' => 'A model-agnostic harness uses the best available model at every stage, from brief through to creative. Amazon Bedrock and other leading models are the defaults; switch to any model, including your own, as models evolve.' ),
		array( 'post' => 8877, 'element' => 'dc3b52e', 'setting' => 'editor',
			'marker' => 'Personalisation Hub identifies them via check-in, mobile app, QR code or when they join a virtual queue.',
			'find' => 'As customers arrive in-store, Personalisation Hub identifies them via check-in, mobile app, QR code or when they join a virtual queue.',
			'replace' => 'As customers arrive in-store, Personalisation Hub identifies them when they check in – via a virtual queue, appointment, click-and-collect, QR code, proximity or your own check-in mechanism.' ),
		array( 'post' => 8877, 'element' => 'b73c3a9', 'setting' => 'editor',
			'marker' => 'The AI optimisation loop continuously refines creative, scheduling and targeting',
			'find' => 'The AI optimisation loop continuously refines creative, scheduling and targeting – without anyone lifting a finger.',
			'replace' => 'The closed loop analyses each campaign’s performance and optimises its next version – creative, scheduling and targeting – to drive more revenue, without anyone lifting a finger.' ),
	);
}

/** Regex (no delimiters) matching $s with typography variants treated as equal. */
function legacy_copy_v2_pattern( $s ) {
	$classes = array(
		'apos'  => '(?:’|‘|\'|&#8217;|&#8216;|&#0?39;|&#x27;|&apos;|&rsquo;|&lsquo;)',
		'quote' => '(?:“|”|"|&quot;|&#0?34;|&#8220;|&#8221;|&ldquo;|&rdquo;)',
		'dash'  => '(?:–|—|&#8211;|&#8212;|&ndash;|&mdash;)',
		'space' => '(?:\x{00A0}| |&nbsp;|&#160;)',
		'amp'   => '(?:&amp;|&#0?38;|&)',
	);
	$tokens = preg_split( '/(&#8217;|&#8216;|&#0?39;|&#x27;|&apos;|&rsquo;|&lsquo;|&quot;|&#0?34;|&#8220;|&#8221;|&ldquo;|&rdquo;|&#8211;|&#8212;|&ndash;|&mdash;|&nbsp;|&#160;|&amp;|&#0?38;|’|‘|\'|“|”|"|–|—|\x{00A0}| |&)/u', $s, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY );
	$map    = array(
		'apos'  => array( '’', '‘', "'", '&#8217;', '&#8216;', '&apos;', '&rsquo;', '&lsquo;', '&#x27;' ),
		'quote' => array( '“', '”', '"', '&quot;', '&#8220;', '&#8221;', '&ldquo;', '&rdquo;' ),
		'dash'  => array( '–', '—', '&#8211;', '&#8212;', '&ndash;', '&mdash;' ),
		'space' => array( "\xC2\xA0", ' ', '&nbsp;', '&#160;' ),
		'amp'   => array( '&amp;', '&' ),
	);
	$out = '';
	foreach ( $tokens as $tok ) {
		$cls = null;
		foreach ( $map as $name => $list ) {
			if ( in_array( $tok, $list, true ) || ( 'apos' === $name && preg_match( '/^&#0?39;$/', $tok ) ) || ( 'quote' === $name && preg_match( '/^&#0?34;$/', $tok ) ) || ( 'amp' === $name && preg_match( '/^&#0?38;$/', $tok ) ) ) {
				$cls = $name;
				break;
			}
		}
		$out .= null === $cls ? preg_quote( $tok, '/' ) : $classes[ $cls ];
	}
	return $out;
}

/** Number of matches of $find in $hay, exact first, then normalised. Returns array( count, regex|null ). */
function legacy_copy_v2_count( $hay, $find ) {
	$exact = '' === $find ? 0 : substr_count( $hay, $find );
	if ( $exact > 0 ) {
		return array( $exact, null );
	}
	$re = '/' . legacy_copy_v2_pattern( $find ) . '/u';
	$n  = @preg_match_all( $re, $hay );
	return array( false === $n ? 0 : $n, $re );
}

/** Replace $find by $replace in $hay when it matches exactly once. Returns the new string or null. */
function legacy_copy_v2_replace( $hay, $find, $replace ) {
	list( $n, $re ) = legacy_copy_v2_count( $hay, $find );
	if ( 1 !== $n ) {
		return null;
	}
	if ( null === $re ) {
		$pos = strpos( $hay, $find );
		return substr( $hay, 0, $pos ) . $replace . substr( $hay, $pos + strlen( $find ) );
	}
	return preg_replace_callback( $re, function () use ( $replace ) { return $replace; }, $hay, 1 );
}

function legacy_copy_v2_has( $hay, $needle ) {
	list( $n ) = legacy_copy_v2_count( $hay, $needle );
	return $n > 0;
}

/** Reference to the setting at a dotted path inside an element, or null when absent / not a string. */
function &legacy_copy_v2_ref( array &$el, $path ) {
	$null = null;
	if ( ! isset( $el['settings'] ) || ! is_array( $el['settings'] ) ) {
		return $null;
	}
	$node = &$el['settings'];
	foreach ( explode( '.', $path ) as $key ) {
		if ( ! is_array( $node ) || ! array_key_exists( $key, $node ) ) {
			return $null;
		}
		$node = &$node[ $key ];
	}
	if ( ! is_string( $node ) ) {
		return $null;
	}
	return $node;
}

/** Apply one target. Returns array( status, before, after ); status is changed|skipped|missing. */
function legacy_copy_v2_apply_target( array &$elements, array $t ) {
	foreach ( $elements as &$el ) {
		if ( isset( $el['id'] ) && (string) $el['id'] === $t['element'] ) {
			$ref = &legacy_copy_v2_ref( $el, $t['setting'] );
			$cur = null === $ref ? '' : $ref;
			if ( '' === $cur || ! legacy_copy_v2_has( $cur, $t['marker'] ) ) {
				return array( 'skipped', $cur, $cur );
			}
			$new = legacy_copy_v2_replace( $cur, $t['find'], $t['replace'] );
			if ( null === $new || $new === $cur ) {
				return array( 'skipped', $cur, $cur );
			}
			$ref = $new;
			return array( 'changed', $cur, $new );
		}
		if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
			$r = legacy_copy_v2_apply_target( $el['elements'], $t );
			if ( 'missing' !== $r[0] ) {
				return $r;
			}
		}
	}
	return array( 'missing', '', '' );
}

/** Pure core: apply every target for one post to its decoded _elementor_data. Returns array( data, results, changed ). */
function legacy_copy_v2_migrate_data( array $data, array $targets ) {
	$results = array();
	$changed = false;
	foreach ( $targets as $t ) {
		list( $status, $before, $after ) = legacy_copy_v2_apply_target( $data, $t );
		$results[]                       = array( 'post' => $t['post'], 'element' => $t['element'], 'setting' => $t['setting'], 'status' => $status, 'before' => $before, 'after' => $after );
		if ( 'changed' === $status ) {
			$changed = true;
		}
	}
	return array( $data, $results, $changed );
}

function legacy_copy_v2_clear_caches( $post_id ) {
	delete_post_meta( $post_id, '_elementor_css' );
	delete_post_meta( $post_id, '_elementor_element_cache' );
	if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
		\Elementor\Plugin::$instance->files_manager->clear_cache();
	}
}

function legacy_copy_v2_run() {
	if ( get_option( LEGACY_COPY_V2_DONE_OPTION ) ) {
		return;
	}
	// add_option fails when the row exists: atomic, so two requests cannot both run the migration.
	if ( ! add_option( LEGACY_COPY_V2_LOCK_OPTION, (string) time(), '', 'no' ) ) {
		return;
	}
	$all     = array();
	$by_post = array();
	foreach ( legacy_copy_v2_targets() as $t ) {
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
	update_option( LEGACY_COPY_V2_ROLLBACK_OPTION, $all, false );
	update_option(
		LEGACY_COPY_V2_DONE_OPTION,
		array(
			'ran_at'  => gmdate( 'c' ),
			'changed' => count( array_filter( $all, function ( $r ) { return 'changed' === $r['status']; } ) ),
			'skipped' => count( array_filter( $all, function ( $r ) { return 'skipped' === $r['status']; } ) ),
			'missing' => count( array_filter( $all, function ( $r ) { return 'missing' === $r['status']; } ) ),
		),
		false
	);
	delete_option( LEGACY_COPY_V2_LOCK_OPTION );
}

if ( function_exists( 'add_action' ) && ! defined( 'PH_LEGACY_COPY_TEST' ) ) {
	add_action( 'init', __NAMESPACE__ . '\\legacy_copy_v2_run', 21 );
}
