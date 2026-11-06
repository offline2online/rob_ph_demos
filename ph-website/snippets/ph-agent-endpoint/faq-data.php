<?php
/**
 * PH Agent Endpoint: feature Q&A content. Page id => [heading, questions].
 * Every answer is a direct answer (1-2 sentences), then detail, then Help Centre links.
 * Live features only. Kept consistent with the Help Centre articles linked in each entry;
 * tests/run.php checks every link against faq/data/index.json.
 */
if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_AE_TESTS' ) ) {
	return array();
}
return array(
	7020 => array(
		'heading'   => 'Digital signage questions',
		'questions' => array(
			array(
				'q'     => 'What is AI-native digital signage?',
				'a'     => 'It is digital signage you run on your own domain, in your own AWS account, with AI agents that help create the campaigns the screens play. Screens play the playlist of their display type, so one upload reaches every screen of that type.',
				'd'     => 'Campaigns can be scheduled, localised to a store or display, targeted at an audience, or triggered by a real-time event. The same platform also runs queueing, appointments and mobile store sites.',
				'links' => array(
					array( 'About Personalisation Hub', '/support-centre/getting-started/about-personalisation-hub/' ),
					array( 'Enable digital signage', '/support-centre/digital-signage/enable-digital-signage/' ),
				),
			),
			array(
				'q'     => 'Which screens and players does it support?',
				'a'     => 'Any digital signage hardware. The player is a progressive web app (PWA) that is easily extended to the players you already use; Amazon Signage, Fire TV, ChromeOS and Android are examples.',
				'd'     => 'ChromeOS and Android devices are managed through your own MDM or CDM. Each display then shows its status, active playlist and any playback issues in the Displays & Devices list.',
				'links' => array(
					array( 'Enable digital signage', '/support-centre/digital-signage/enable-digital-signage/' ),
					array( 'Register a new display or device', '/support-centre/digital-signage/register-a-new-display-or-device/' ),
				),
			),
			array(
				'q'     => 'How does a campaign reach a screen?',
				'a'     => 'A campaign is connected to a screen through the playlist of its display type. Add the campaign to the playlist once and every display of that type plays it.',
				'd'     => 'You choose the schedule, targeting and priority for each campaign, and can activate or deactivate it at any time.',
				'links' => array(
					array( 'Create a display type and playlist', '/support-centre/digital-signage/create-a-display-type-and-playlist/' ),
					array( 'Add a campaign to play on a digital signage display', '/support-centre/launching-campaigns/add-a-campaign-to-play-on-a-digital-signage-display/' ),
					array( 'Prioritise which campaigns play first', '/support-centre/launching-campaigns/prioritise-which-campaigns-play-first/' ),
				),
			),
			array(
				'q'     => 'Can different stores or screens show different content?',
				'a'     => 'Yes. Targeting rules combine store segments, display tags, the languages of staff on shift and visitors\' reasons for visit, so each store or screen plays what suits it.',
				'd'     => 'Store segments group stores by mostly stable attributes such as demographics or a metro, regional or airport location. Weather and stock are handled dynamically, from each store\'s current temperature and real-time stock levels.',
				'links' => array(
					array( 'Localise campaigns with store segments', '/support-centre/launching-campaigns/localise-campaigns-with-store-segments/' ),
					array( 'Target campaigns at specific displays with display tags', '/support-centre/launching-campaigns/target-campaigns-at-specific-displays-with-display-tags/' ),
					array( 'Target a campaign', '/support-centre/launching-campaigns/target-a-campaign/' ),
				),
			),
			array(
				'q'     => 'How do I know my screens are working?',
				'a'     => 'The Displays & Devices list shows each screen\'s status and time offline, and the platform can notify you when a display goes offline.',
				'd'     => 'You can also view a display\'s log history and a campaign playback audit to find playback problems.',
				'links' => array(
					array( 'View a display\'s status and time offline', '/support-centre/digital-signage/view-a-displays-status-and-time-offline/' ),
					array( 'Get notified when a display goes offline', '/support-centre/digital-signage/get-notified-when-a-display-goes-offline/' ),
					array( 'View the campaign playback audit for a display', '/support-centre/digital-signage/view-the-campaign-playback-audit-for-a-display/' ),
				),
			),
			array(
				'q'     => 'How do I switch digital signage on?',
				'a'     => 'An HQ Admin user switches it on once for the organisation in Platform Admin, then once for each store that has screens. Allow about 5 minutes, plus your device management set-up.',
				'd'     => 'Until both are on, devices in that store cannot register or receive campaigns.',
				'links' => array(
					array( 'Enable digital signage', '/support-centre/digital-signage/enable-digital-signage/' ),
					array( 'Create a display type and playlist', '/support-centre/digital-signage/create-a-display-type-and-playlist/' ),
				),
			),
		),
	),
	3566 => array(
		'heading'   => 'In-store personalisation questions',
		'questions' => array(
			array(
				'q'     => 'What is in-store personalisation?',
				'a'     => 'It is personalisation that follows a visitor through one store visit, across their phone, the store\'s screens and the staff tablet. It uses what the platform knows about the visitor and the store at that moment.',
				'd'     => 'It starts with extensible store check-in: virtual queues, appointments, click-and-collect, context-aware store sites, QR and proximity are built in, and you can add your own check-in mechanisms through the Visitor API and customisable, updatable edge models.',
				'links' => array(
					array( 'About Personalisation Hub', '/support-centre/getting-started/about-personalisation-hub/' ),
					array( 'Use cases supported by Personalisation Hub', '/support-centre/getting-started/use-cases-supported-by-personalisation-hub/' ),
				),
			),
			array(
				'q'     => 'What data does it use?',
				'a'     => 'It uses your own first-party data, sent to the platform through the Visitor API from your CDP, CRM, loyalty or decisioning systems, together with store context such as segments and opening hours.',
				'd'     => 'The platform uses that data on every touch-point the visitor meets: the display at the door, the mobile store site on their phone, the staff tablet and the insights HQ sees afterwards.',
				'links' => array(
					array( 'Use customer and decisioning data to personalise the store visit', '/support-centre/personalisation-and-ai/use-customer-and-decisioning-data-to-personalise-the-store-visit/' ),
					array( 'Connect your mobile app or third-party system to the Visitor API', '/support-centre/personalisation-and-ai/connect-your-mobile-app-or-third-party-system-to-the-visitor-api/' ),
					array( 'Trigger campaigns from customer or decisioning data', '/support-centre/personalisation-and-ai/trigger-campaigns-from-customer-or-decisioning-data/' ),
				),
			),
			array(
				'q'     => 'What is QR Control?',
				'a'     => 'QR Control lets a customer scan a code on a store screen and take it over from their own phone. The screen and the phone then work together and both reflect who the customer is.',
				'd'     => 'Instead of watching a passive screen, the customer can chat, play and explore. HQ enables it per display and sets the default QR code settings.',
				'links' => array(
					array( 'How QR Control works', '/support-centre/personalisation-and-ai/how-qr-control-works/' ),
					array( 'Why use QR Control: for retailers, brands and advertisers', '/support-centre/personalisation-and-ai/why-use-qr-control/' ),
					array( 'Enable QR Control and set the default QR code settings', '/support-centre/personalisation-and-ai/enable-qr-control-and-set-the-default-qr-code-settings/' ),
				),
			),
			array(
				'q'     => 'Does it use cameras, and are images stored?',
				'a'     => 'Computer vision is optional and needs a webcam connected to a display. The vision model runs on the display\'s own device at the edge, and only anonymous audience attributes are used to target campaigns.',
				'd'     => 'No images of shoppers are stored. Computer vision drives real-time targeting and creative optimisation; age and gender is the default model, and models can be customised with you. You set the targeting rule on the campaign and switch computer vision on for the display.',
				'links' => array(
					array( 'Does computer vision store images of shoppers?', '/support-centre/personalisation-and-ai/does-computer-vision-store-images-of-shoppers/' ),
					array( 'Target passers-by using computer vision at the edge', '/support-centre/launching-campaigns/target-passers-by-using-computer-vision-at-the-edge/' ),
				),
			),
			array(
				'q'     => 'Can it react to a visitor\'s position in the store?',
				'a'     => 'Yes, with MIST proximity personalisation. A display changes what it plays as a known visitor\'s phone enters a zone or comes within range of a virtual beacon.',
				'd'     => 'You need MIST access points deployed in your stores and a MIST organisation ID and API token. HQ then maps each store to its MIST site and each display to a zone or virtual beacon.',
				'links' => array(
					array( 'Enable proximity personalisation with MIST', '/support-centre/personalisation-and-ai/enable-proximity-personalisation-with-mist/' ),
				),
			),
			array(
				'q'     => 'How do I see what worked?',
				'a'     => 'Insights / Analytics in HQ Admin gives you full visibility of what happens in your stores, and feeds your existing analytics for a complete 360° view.',
				'd'     => 'Because the loop is closed, marketing attribution can include in-store transactions. Use it to review how each campaign performed and decide what to run next.',
				'links' => array(
					array( 'Review campaign performance in Insights / Analytics', '/support-centre/launching-campaigns/review-campaign-performance-in-insights-analytics/' ),
					array( 'Use customer and decisioning data to personalise the store visit', '/support-centre/personalisation-and-ai/use-customer-and-decisioning-data-to-personalise-the-store-visit/' ),
				),
			),
		),
	),
	6254 => array(
		'heading'   => 'AI campaign creation questions',
		'questions' => array(
			array(
				'q'     => 'How does the platform create campaigns with AI?',
				'a'     => 'You describe the campaign to the AI assistant, by typing or speaking, and the platform writes the campaign brief. From the brief it generates a storyboard, copy and creative for each enabled touch-point.',
				'd'     => 'AI skills run in sequence: capture the request, write the brief, generate the storyboard and copy, then generate the creative and preview video. You review and refine each stage.',
				'links' => array(
					array( 'Launch a new campaign', '/support-centre/launching-campaigns/launch-a-new-campaign/' ),
					array( 'Generate storyboard, copy and creative with AI', '/support-centre/launching-campaigns/generate-storyboard-copy-and-creative-with-ai/' ),
					array( 'AI agents and skills reference', '/support-centre/personalisation-and-ai/ai-agents-and-skills-reference/' ),
				),
			),
			array(
				'q'     => 'Which AI models does it use?',
				'a'     => 'Any model you choose. A model-agnostic harness assigns a model to each AI skill; OpenAI, Google Gen AI and LTX are the defaults the creative process is first optimised for, and you can use any model, including your own internal models, as models evolve.',
				'd'     => 'Different skills can use different models. The platform calls the providers you configure from your own AWS account, through a Squid proxy.',
				'links' => array(
					array( 'Connect AI models and providers', '/support-centre/personalisation-and-ai/connect-ai-models-and-providers/' ),
					array( 'AI agents and skills reference', '/support-centre/personalisation-and-ai/ai-agents-and-skills-reference/' ),
					array( 'Where is my data stored and how is the platform secured?', '/support-centre/getting-started/where-is-my-data-stored-and-how-is-the-platform-secured/' ),
				),
			),
			array(
				'q'     => 'Will the AI follow our brand and objectives?',
				'a'     => 'Yes. The brief draws on the target audiences, campaign objectives and brand guidelines that you define in the platform.',
				'd'     => 'Upload your brand guidelines once, and the AI agents use them for every campaign they create.',
				'links' => array(
					array( 'Upload your brand guidelines for the AI agents', '/support-centre/company-set-up-and-users/upload-your-brand-guidelines-for-the-ai-agents/' ),
					array( 'Define target audiences and campaign objectives', '/support-centre/company-set-up-and-users/define-target-audiences-and-campaign-objectives/' ),
				),
			),
			array(
				'q'     => 'Can we create a campaign without AI?',
				'a'     => 'Yes. The same Launch a New Campaign button also offers a manual option, where you define the campaign information and upload the assets yourself.',
				'd'     => 'When the brief is written by hand, the two brief-stage AI skills are not used. The remaining generation steps only run if you select them on the campaign.',
				'links' => array(
					array( 'Launch a new campaign', '/support-centre/launching-campaigns/launch-a-new-campaign/' ),
					array( 'Generate storyboard, copy and creative with AI', '/support-centre/launching-campaigns/generate-storyboard-copy-and-creative-with-ai/' ),
				),
			),
			array(
				'q'     => 'How are campaigns optimised?',
				'a'     => 'With closed-loop campaign optimisation enabled, the platform analyses how each campaign performs and optimises the next version of that campaign, so it drives more revenue.',
				'd'     => 'Optimisation works alongside targeting and prioritisation, and HQ can review campaign performance in Insights / Analytics.',
				'links' => array(
					array( 'AI agents and skills reference', '/support-centre/personalisation-and-ai/ai-agents-and-skills-reference/' ),
					array( 'Review campaign performance in Insights / Analytics', '/support-centre/launching-campaigns/review-campaign-performance-in-insights-analytics/' ),
					array( 'Prioritise which campaigns play first', '/support-centre/launching-campaigns/prioritise-which-campaigns-play-first/' ),
				),
			),
		),
	),
	2711 => array(
		'heading'   => 'Check-in and queue management questions',
		'questions' => array(
			array(
				'q'     => 'How do visitors check in when they arrive?',
				'a'     => 'Visitors join the store queue by scanning a QR code on a display or kiosk, or staff greet them and add them manually. Visitors then get SMS updates, so they can browse instead of standing in line.',
				'd'     => 'A visitor can also scan a QR code on the staff tablet. Staff see the arrival on the tablet and pick the visitor up in turn.',
				'links' => array(
					array( 'Let a visitor join the queue by scanning a QR code on a display', '/support-centre/queue-management/let-a-visitor-join-the-queue-by-scanning-a-qr-code-on-a-display/' ),
					array( 'Let a visitor join the queue by scanning the QR code on the staff tablet', '/support-centre/queue-management/let-a-visitor-join-the-queue-by-scanning-the-qr-code-on-the-staff-tablet/' ),
					array( 'Add a visitor to the queue manually', '/support-centre/queue-management/add-a-visitor-to-the-queue-manually/' ),
				),
			),
			array(
				'q'     => 'How does the platform identify who has arrived?',
				'a'     => 'When a visitor checks in, they give an identifier, so staff can find them and the platform can match them to the data you hold in your own systems.',
				'd'     => 'Matching uses the Visitor API. Staff can then see the visitor\'s recent interactions and profile data when they pick them up.',
				'links' => array(
					array( 'Use customer and decisioning data to personalise the store visit', '/support-centre/personalisation-and-ai/use-customer-and-decisioning-data-to-personalise-the-store-visit/' ),
					array( 'View a visitor\'s recent interactions and profile data', '/support-centre/queue-management/view-a-visitor-s-recent-interactions-and-profile-data/' ),
					array( 'Connect your mobile app or third-party system to the Visitor API', '/support-centre/personalisation-and-ai/connect-your-mobile-app-or-third-party-system-to-the-visitor-api/' ),
				),
			),
			array(
				'q'     => 'How is the wait time estimated?',
				'a'     => 'Each reason for visit has a time to serve. That time drives the estimated wait shown to visitors and the queue statistics shown to managers.',
				'd'     => 'You set the reasons for visit and their times when you set up queueing, and can tune them later.',
				'links' => array(
					array( 'Add reason-for-visit categories and sub-categories', '/support-centre/queue-management/add-reason-for-visit-categories-and-sub-categories/' ),
					array( 'Queue settings reference', '/support-centre/queue-management/queue-settings-reference/' ),
					array( 'View store queueing stats and the staff status widget', '/support-centre/queue-management/view-store-queueing-stats-and-the-staff-status-widget/' ),
				),
			),
			array(
				'q'     => 'What can staff do from the tablet?',
				'a'     => 'Staff pick up a visitor, place them on hold, add notes and hand them over, all from the Retail Admin staff tablet.',
				'd'     => 'Every store and every staff member has Retail Admin, with admin, manager and staff roles and a personal login for their own store(s). Staff can also see which languages colleagues on shift speak, and a manager can remove a visitor from the queue or handle special requests.',
				'links' => array(
					array( 'Pick up a visitor from the queue', '/support-centre/queue-management/pick-up-a-visitor-from-the-queue/' ),
					array( 'Place a visitor on hold', '/support-centre/queue-management/place-a-visitor-on-hold/' ),
					array( 'Handle visitors with special requests (language or business customers)', '/support-centre/queue-management/handle-visitors-with-special-requests-language-or-business-customers/' ),
				),
			),
			array(
				'q'     => 'How long does it take to set up?',
				'a'     => 'An HQ Admin user enables virtual store queueing in about 15 minutes. The default settings are fine for a first test.',
				'd'     => 'The set-up has four parts: enable queueing, add reason-for-visit categories, upload store staff, and set up the SMS sender ID.',
				'links' => array(
					array( 'Enable virtual store queueing', '/support-centre/queue-management/enable-virtual-store-queueing/' ),
					array( 'Update the platform\'s SMS sender ID', '/support-centre/queue-management/update-the-platform-s-sms-sender-id/' ),
				),
			),
		),
	),
	3035 => array(
		'heading'   => 'Appointment booking questions',
		'questions' => array(
			array(
				'q'     => 'What do appointment bookings do?',
				'a'     => 'Customers choose a time to visit a store, collect an order or check in on arrival, instead of waiting in the store\'s virtual queue.',
				'd'     => 'Bookings are made for a service or a click-and-collect pickup, and the customer receives SMS and email messages.',
				'links' => array(
					array( 'Enable appointment bookings', '/support-centre/appointment-bookings/enable-appointment-bookings/' ),
					array( 'About Personalisation Hub', '/support-centre/getting-started/about-personalisation-hub/' ),
				),
			),
			array(
				'q'     => 'Who controls the available slots?',
				'a'     => 'Each store sets its own slots per weekday and public holiday. HQ sets the template rules, such as duration, buffers, lead times and cancellation windows.',
				'd'     => 'Calendar blocking removes dates and times a store cannot serve.',
				'links' => array(
					array( 'Set appointment slots per store and per day', '/support-centre/appointment-bookings/set-appointment-slots-per-store-and-per-day/' ),
					array( 'Appointment template settings reference', '/support-centre/appointment-bookings/appointment-template-settings-reference/' ),
					array( 'Block out dates and times for appointments', '/support-centre/appointment-bookings/block-out-dates-and-times-for-appointments/' ),
				),
			),
			array(
				'q'     => 'What messages do customers receive?',
				'a'     => 'Customers receive SMS and email confirmations, reminders and check-in messages.',
				'd'     => 'SMS needs sending approved in AWS and a platform SMS sender ID set before you launch bookings.',
				'links' => array(
					array( 'Appointment SMS and email notifications', '/support-centre/appointment-bookings/appointment-sms-and-email-notifications/' ),
					array( 'Update the platform\'s SMS sender ID', '/support-centre/queue-management/update-the-platform-s-sms-sender-id/' ),
				),
			),
			array(
				'q'     => 'How do customers check in for an appointment?',
				'a'     => 'On arrival the customer can scan the QR code on the entrance display to check in for the appointment and give an identifier so staff can find them.',
				'd'     => 'Staff are notified of the arrival and see the relevant insights when they pick the customer up.',
				'links' => array(
					array( 'Use customer and decisioning data to personalise the store visit', '/support-centre/personalisation-and-ai/use-customer-and-decisioning-data-to-personalise-the-store-visit/' ),
					array( 'Enable appointment bookings', '/support-centre/appointment-bookings/enable-appointment-bookings/' ),
				),
			),
			array(
				'q'     => 'How long does set-up take?',
				'a'     => 'About 10 minutes in HQ Admin, in four short procedures.',
				'd'     => 'You enable appointments in Platform Admin, enable them for each store, check your reason-for-visit list and decide how you will block out dates and public holidays. Stores need correct opening hours, because slots are offered inside them.',
				'links' => array(
					array( 'Enable appointment bookings', '/support-centre/appointment-bookings/enable-appointment-bookings/' ),
					array( 'Update your store\'s opening hours (Retail Admin)', '/support-centre/stores-and-retail-data/update-your-stores-opening-hours-retail-admin/' ),
				),
			),
		),
	),
	3477 => array(
		'heading'   => 'Mobile store site questions',
		'questions' => array(
			array(
				'q'     => 'What is a mobile store site?',
				'a'     => 'It is a mobile web page that the platform generates for every store. Its content changes with the visitor\'s context, so there is no app to install.',
				'd'     => 'Each site is built from a mobile site template that defines the header, the menu items and whether visitors can scan a display\'s QR code from inside it.',
				'links' => array(
					array( 'Why create a mobile site for your stores?', '/support-centre/mobile-store-sites/why-create-a-mobile-site-for-your-stores/' ),
					array( 'Define your default mobile site template', '/support-centre/mobile-store-sites/define-your-default-mobile-site-template/' ),
				),
			),
			array(
				'q'     => 'How does the site change for each visitor?',
				'a'     => 'The menu changes with the visitor\'s state: Away from Store, Connected Store, Connected Display or Connected Website.',
				'd'     => 'The same link can offer directions on the way in, the queue once the visitor has checked in and an offer at a specific display.',
				'links' => array(
					array( 'Why create a mobile site for your stores?', '/support-centre/mobile-store-sites/why-create-a-mobile-site-for-your-stores/' ),
					array( 'Personalise a visitor\'s store experience', '/support-centre/mobile-store-sites/personalise-a-visitors-store-experience/' ),
				),
			),
			array(
				'q'     => 'How do visitors reach the site?',
				'a'     => 'Through the store\'s QR code, which you can download for each store, or by scanning a display\'s QR code with QR Control.',
				'd'     => 'Messages the platform sends, such as appointment confirmations, can also open the branch\'s site.',
				'links' => array(
					array( 'Download a store\'s QR code for its mobile store site', '/support-centre/stores-and-retail-data/download-a-stores-qr-code-for-its-mobile-store-site/' ),
					array( 'Why create a mobile site for your stores?', '/support-centre/mobile-store-sites/why-create-a-mobile-site-for-your-stores/' ),
					array( 'About Personalisation Hub', '/support-centre/getting-started/about-personalisation-hub/' ),
				),
			),
			array(
				'q'     => 'Can different parts of a store show different sites?',
				'a'     => 'Yes. You can assign a different template to a store, a display or a zone, so the entrance, a gaming zone and the concierge each show their own menu.',
				'd'     => 'Allow about 30 minutes for a store with three zones.',
				'links' => array(
					array( 'Assign a different mobile site template to a store, display or zone', '/support-centre/mobile-store-sites/assign-a-different-mobile-site-template-to-a-store-display-or-zone/' ),
					array( 'Personalise a visitor\'s store experience', '/support-centre/mobile-store-sites/personalise-a-visitors-store-experience/' ),
				),
			),
			array(
				'q'     => 'Can I choose which campaigns the site shows?',
				'a'     => 'Yes. You choose which campaigns appear in the campaign carousel and the order they appear in.',
				'd'     => 'You can also create a call to action for campaigns that are on rotation.',
				'links' => array(
					array( 'Choose which campaigns appear in the campaign carousel', '/support-centre/mobile-store-sites/choose-which-campaigns-appear-in-the-campaign-carousel/' ),
					array( 'Control the order campaigns are presented in', '/support-centre/mobile-store-sites/control-the-order-campaigns-are-presented-in/' ),
					array( 'Create a call to action for on-rotation campaigns', '/support-centre/mobile-store-sites/create-a-call-to-action-for-on-rotation-campaigns/' ),
				),
			),
		),
	),
	3973 => array(
		'heading'   => 'Localisation and geo-targeting questions',
		'questions' => array(
			array(
				'q'     => 'What is localisation in Personalisation Hub?',
				'a'     => 'It is targeting a campaign at the stores, displays or visitors where it will work best. Rules combine store and location data with queueing data and visitor data.',
				'd'     => 'The main inputs are store segments, display tags, the languages of staff on shift and visitors\' reasons for visit.',
				'links' => array(
					array( 'Localise campaigns with store segments', '/support-centre/launching-campaigns/localise-campaigns-with-store-segments/' ),
					array( 'Target a campaign', '/support-centre/launching-campaigns/target-a-campaign/' ),
				),
			),
			array(
				'q'     => 'What are fixed and variable store segments?',
				'a'     => 'Fixed segments, such as Airport, Metro or Regional, group stores by stable attributes; variable segments can be updated per store. Weather and stock are handled dynamically, not by segments.',
				'd'     => 'Only HQ Admin can assign fixed segments. HQ Admin and store managers can assign variable ones.',
				'links' => array(
					array( 'Localise campaigns with store segments', '/support-centre/launching-campaigns/localise-campaigns-with-store-segments/' ),
					array( 'Localise campaigns by the skills of staff on shift', '/support-centre/launching-campaigns/localise-campaigns-by-the-skills-of-staff-on-shift/' ),
				),
			),
			array(
				'q'     => 'Can a store manager change what plays locally?',
				'a'     => 'Yes. A store manager can switch a variable segment on from the Retail Admin staff tablet, and the campaigns for that condition start or stop in that store.',
				'd'     => 'This lets a store update its own attributes without waiting for HQ, while weather and stock are picked up automatically from current temperature and real-time stock levels.',
				'links' => array(
					array( 'Localise campaigns with store segments', '/support-centre/launching-campaigns/localise-campaigns-with-store-segments/' ),
					array( 'Let retail staff activate triggered campaigns', '/support-centre/personalisation-and-ai/let-retail-staff-activate-triggered-campaigns/' ),
				),
			),
			array(
				'q'     => 'Can I target specific screens?',
				'a'     => 'Yes. Add display tags to displays, then target a campaign at those tags.',
				'd'     => 'Display tags let you pick out particular screens, whichever store they are in.',
				'links' => array(
					array( 'Target campaigns at specific displays with display tags', '/support-centre/launching-campaigns/target-campaigns-at-specific-displays-with-display-tags/' ),
					array( 'Target a campaign', '/support-centre/launching-campaigns/target-a-campaign/' ),
				),
			),
			array(
				'q'     => 'Can staff skills or visitor needs change what is shown?',
				'a'     => 'Yes. You can localise campaigns by the skills and languages of the staff on shift and by visitors\' reason for visit.',
				'd'     => 'Staff skills and languages come from each staff member\'s profile, and reasons for visit come from the visitors\' queue and appointment choices.',
				'links' => array(
					array( 'Localise campaigns by the skills of staff on shift', '/support-centre/launching-campaigns/localise-campaigns-by-the-skills-of-staff-on-shift/' ),
					array( 'Localise campaigns by visitors\' reason for visit', '/support-centre/launching-campaigns/localise-campaigns-by-visitors-reason-for-visit/' ),
				),
			),
		),
	),
	2389 => array(
		'heading'   => 'Self-hosted AWS deployment questions',
		'questions' => array(
			array(
				'q'     => 'What does self-hosted mean for Personalisation Hub?',
				'a'     => 'Personalisation Hub is installed from AWS Marketplace into a private VPC in your own AWS account, on your own domain. There is no shared multi-tenant service.',
				'd'     => 'Your store, campaign and customer data stay in your account, in the AWS Region you choose at installation.',
				'links' => array(
					array( 'Where is my data stored and how is the platform secured?', '/support-centre/getting-started/where-is-my-data-stored-and-how-is-the-platform-secured/' ),
					array( 'Install Personalisation Hub from AWS Marketplace', '/support-centre/platform-installation/install-personalisation-hub-from-aws-marketplace/' ),
				),
			),
			array(
				'q'     => 'How long does installation take?',
				'a'     => 'A little over one hour end to end. You launch a single CloudFormation stack from AWS Marketplace and run the Installation Wizard.',
				'd'     => 'The wizard asks for a Master Admin account, the environment type and size, and your platform domain, and then provisions the full stack.',
				'links' => array(
					array( 'Install Personalisation Hub from AWS Marketplace', '/support-centre/platform-installation/install-personalisation-hub-from-aws-marketplace/' ),
					array( 'Step 1 — Deploy the platform through AWS Marketplace', '/support-centre/platform-installation/step-1-deploy-the-platform-through-aws-marketplace/' ),
					array( 'Step 2 — Run the Installation Wizard', '/support-centre/platform-installation/step-2-run-the-installation-wizard/' ),
				),
			),
			array(
				'q'     => 'Where is my data stored and how is it secured?',
				'a'     => 'In your own AWS account, in private subnets. It is encrypted at rest with customer-managed KMS keys and in transit with TLS.',
				'd'     => 'The core database is Amazon RDS for PostgreSQL. Campaign assets and backups are in Amazon S3, logs and analytics are in Amazon OpenSearch Service, and cache and session data are in Amazon ElastiCache. You can also restrict platform access by IP address.',
				'links' => array(
					array( 'Where is my data stored and how is the platform secured?', '/support-centre/getting-started/where-is-my-data-stored-and-how-is-the-platform-secured/' ),
					array( 'AWS deployment: resources provisioned', '/support-centre/platform-installation/aws-deployment-resources-provisioned/' ),
					array( 'Step 7 — Restrict platform access by IP address', '/support-centre/platform-installation/step-7-restrict-platform-access-by-ip-address/' ),
				),
			),
			array(
				'q'     => 'What does the platform run on?',
				'a'     => 'A set of microservices on Amazon EKS, with managed AWS services for data, messaging, search and encryption.',
				'd'     => 'Components scale independently. Outbound calls, such as those to AI model providers, leave through a Squid proxy.',
				'links' => array(
					array( 'AWS deployment: architecture', '/support-centre/platform-installation/aws-deployment-architecture/' ),
					array( 'AWS deployment: prerequisites', '/support-centre/platform-installation/aws-deployment-prerequisites/' ),
					array( 'AWS deployment: lifecycle management', '/support-centre/platform-installation/aws-deployment-lifecycle-management/' ),
				),
			),
			array(
				'q'     => 'Is there a free trial?',
				'a'     => 'Yes. The AWS Marketplace subscription includes a 30-day free trial of the licence, and you can cancel at any time.',
				'd'     => 'AWS infrastructure costs are billed separately, through your own AWS account.',
				'links' => array(
					array( 'Is there a free trial?', '/support-centre/getting-started/is-there-a-free-trial/' ),
					array( 'AWS deployment: prerequisites', '/support-centre/platform-installation/aws-deployment-prerequisites/' ),
				),
			),
		),
	),
);
