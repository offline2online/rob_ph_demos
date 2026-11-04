<?php
/**
 * PH Agent Endpoint: the installation spec (tool get_installation_spec). Pure PHP, no WordPress calls.
 *
 * ONE source of truth for how an agent provisions Personalisation Hub in a retailer's own AWS account.
 * WebMCP and the public remote MCP server both read it through the same REST route, so they cannot differ.
 *
 * Honesty rule: every value below is either confirmed against the live AWS Marketplace listing
 * (checked 4 Nov 2026) or the Help Centre install articles, or it is marked
 * { status: "unconfirmed" } with a null value and a note. Nothing is guessed. In particular
 * there is NO IAM policy JSON, NO template URL and NO health-check endpoint here until the
 * owner supplies them: they are not public. A test fails if an unconfirmed item gains a value.
 */
namespace AngieSnippets\PhAgentEndpoint___ID__;

const INSTALL_SPEC_VERSION   = '2026-11-04';
const MARKETPLACE_PRODUCT_ID = '76fb12fb-ca7e-4352-b691-6aa83d9be3e2';
const MARKETPLACE_LISTING_ID = 'prodview-3uiwcnbrpvj76';
const HELP_BASE              = 'https://help.personalisationhub.com';

/** An item we do not have a confirmed, public value for. Value is always null. */
function unconfirmed( $note ) {
	return array( 'status' => 'unconfirmed', 'value' => null, 'note' => $note );
}

function installation_spec() {
	$subscribe = 'https://aws.amazon.com/marketplace/procurement?productId=' . MARKETPLACE_PRODUCT_ID;
	return array(
		'specVersion'  => INSTALL_SPEC_VERSION,
		'readOnly'     => true,
		'summary'      => 'Subscribe to Personalisation Hub on AWS Marketplace and launch its CloudFormation template in the retailer\'s own AWS account. The stack builds an isolated VPC with an installer EC2 instance that serves a browser-based Installation Wizard. The wizard itself is out of scope for this spec.',
		'humanApproval' => array(
			'required' => true,
			'steps'    => array( 'Accepting the AWS Marketplace subscription terms', 'Accepting the end user licence agreement (EULA)', 'Approving the CloudFormation IAM-capabilities acknowledgement' ),
			'note'     => 'An agent must stop and hand each of these to a human with authority over the AWS account. Do not accept them on a person\'s behalf.',
			'eulaUrl'  => 'https://d7umqicpi7263.cloudfront.net/eula/XCcLxfdXSt5BLUb3cZGNUWPOB6QpbDcHHZTGWnkd_l8',
		),
		'marketplace'  => array(
			'listingUrl'       => FREE_TRIAL_URL,
			'listingId'        => MARKETPLACE_LISTING_ID,
			'productId'        => MARKETPLACE_PRODUCT_ID,
			'seller'           => array( 'name' => 'Personalisation Hub', 'id' => 'seller-ipgfe4tzltv24' ),
			'subscribeUrl'     => $subscribe,
			'trackedTrialUrl'  => null, // filled per source by tool_installation_spec(): the /go/free-trial/ hop.
			'privateOfferUrl'  => 'https://aws.amazon.com/marketplace/customer-connect/private-offer/' . MARKETPLACE_LISTING_ID,
			'deliveryMethod'   => 'CloudFormation Template',
			'deliveryOption'   => 'PersonalisationHub Installer',
			'latestVersion'    => '4.2.3.8',
			'operatingSystem'  => 'Amazon Linux 2023',
			'checkedOn'        => '2026-11-04',
		),
		'pricing'      => array(
			'currency'        => 'USD',
			'model'           => 'Usage-based, billed hourly through AWS Marketplace.',
			'freeTrial'       => '30 days free on every pricing dimension ($0 free-trial version), then usage-based hourly billing.',
			'dimensions'      => array(
				array( 'name' => 'Platform licence', 'unit' => 'instance per hour', 'usd' => 6.94 ),
				array( 'name' => 'Connected store', 'unit' => 'store per hour', 'usd' => 0.1375 ),
				array( 'name' => 'Connected display', 'unit' => 'display per hour', 'usd' => 0.1375 ),
			),
			'awsInfrastructure' => 'AWS infrastructure costs (compute, database, network and so on) are billed by AWS on top of the licence. Estimate them with https://calculator.aws using the environment size chosen in the wizard.',
			'estimatedRunningCost' => unconfirmed( 'No single running-cost figure is published: it depends on the environment size chosen in the wizard and the store and display counts. Use the dimensions above and the AWS calculator.' ),
			'refunds'         => 'No refunds. Cancel by deleting the stack.',
		),
		'prerequisites' => array(
			'awsAccount'    => 'A separate AWS account is recommended by AWS. Do not use the root user: use an IAM user or role.',
			'permissionsSummary' => array(
				'Subscribe to AWS Marketplace products and start provisioning',
				'Create CloudFormation stacks that include IAM resources (the IAM acknowledgement on the review page)',
				'Request service quota increases through AWS Support',
				'View billing and usage information (optional)',
				'Create and manage the stack\'s components: IAM, EKS, EC2, VPC, RDS, ElastiCache, MSK, OpenSearch Service, S3, ELB, ACM, KMS and Systems Manager',
			),
			'iamPolicy'     => unconfirmed( 'The least-privilege IAM policy JSON is not published. It will be added once the owner supplies it. Do not invent or widen a policy: until then use the permissions summary above with the account owner.' ),
			'regions'       => array(
				'status'      => 'partly-confirmed',
				'summary'     => 'Every commercial AWS Region. AWS GovCloud and the China Regions are not supported. Release 4.2.3.8 adds Auckland; the full per-region list is not published here.',
				'unsupported' => array( 'AWS GovCloud', 'China Regions' ),
				'permanent'   => true,
				'note'        => 'The Region is chosen when launching the template and cannot be changed afterwards. The single-Availability-Zone, single-Region deployment is the default; contact support for multi-AZ or multi-Region before starting.',
			),
			'serviceQuotas' => array(
				'status' => 'partly-confirmed',
				'check'  => array( 'EC2', 'RDS', 'EKS', 'ElastiCache', 'OpenSearch', 'NAT Gateway', 'VPC' ),
				'note'   => 'Review these in the Service Quotas console before launching. Installation pauses if a limit is reached. Specific numeric minimums are not published.',
			),
		),
		'template'     => array(
			'url'         => unconfirmed( 'The CloudFormation template URL is only shown inside AWS after subscribing, and is not public. Use the Launch CloudFormation step from the Marketplace subscription instead.' ),
			'launchSteps' => array(
				'Open the listing and choose View purchase options',
				'Choose Subscribe (human approval: terms and EULA)',
				'Choose Continue to Configuration',
				'Select fulfilment option CloudFormation Template and the AWS Region (permanent)',
				'Choose Continue to Launch, then Launch CloudFormation, then Launch',
				'On Create stack, leave template settings and choose Next, set the parameters below, Next, Next',
				'Tick the IAM acknowledgement (human approval) and choose Submit',
			),
			'parameters'  => array(
				array(
					'name'        => 'Stack name',
					'type'        => 'String',
					'description' => 'Identifies the environment in CloudFormation, for example ph-staging. This is the CloudFormation stack name, not a template parameter.',
					'default'     => null,
					'allowedValues' => null,
					'validation'  => 'Any length. No spaces.',
					'required'    => true,
					'permanent'   => false,
				),
				array(
					'name'        => 'ResourcePrefix',
					'type'        => 'String',
					'description' => 'Names every AWS resource the stack creates.',
					'default'     => null,
					'allowedValues' => null,
					'validation'  => '15 characters or fewer, all lower-case, no spaces. Example: phstaging2026.',
					'required'    => true,
					'permanent'   => true,
				),
				array(
					'name'        => '3 CIDR fields',
					'type'        => 'String (CIDR)',
					'description' => 'Network access ranges. Set all three to 0.0.0.0/0 on purpose: IP restrictions are applied inside Personalisation Hub after install, not in the stack.',
					'default'     => null,
					'allowedValues' => array( '0.0.0.0/0' ),
					'validation'  => 'Valid IPv4 CIDR. The exact parameter names are not published here: they are shown in the Create stack form.',
					'required'    => true,
					'permanent'   => false,
				),
			),
			'parametersStatus' => 'partly-confirmed',
			'parametersNote'   => 'Only the parameters above are documented. Types, defaults and exact names of any other template parameter are unconfirmed and are not listed. If the Create stack form shows more, stop and ask the human.',
		),
		'deployment'   => array(
			'stackDuration'    => 'About 4 minutes for the stack to reach CREATE_COMPLETE.',
			'totalInstallTime' => 'About 1 hour 15 minutes end to end (stack, then the wizard install of about 55 minutes), of which about 7 minutes is hands-on. Stated on the listing.',
			'resourcesCreatedByStack' => array(
				'A new, isolated VPC',
				'An EC2 instance that hosts the browser-based Installation Wizard and Cost Control page (with launch template, Auto Scaling group and Elastic IP as needed)',
				'IAM roles, users, groups and policies for provisioning and operations, named with the stack name and stack ID prefix',
				'Supporting resources',
			),
			'resourcesCreatedByWizard' => array( 'EKS cluster and node groups', 'RDS (PostgreSQL)', 'ElastiCache (Redis)', 'MSK (Kafka)', 'OpenSearch Service', 'S3 buckets', 'Application Load Balancer', 'ACM certificate', 'KMS keys', 'CloudWatch log groups and alarms' ),
			'outputs' => array(
				array( 'key' => 'EC2InstancePublicURL', 'description' => 'Public URL of the Installation Wizard (the installer EC2 instance). Open it to hand over to the browser agent.' ),
			),
			'outputsNote' => 'The wizard is reached on the public IP shown in the stack Outputs tab.',
		),
		'verification' => array(
			'stackSucceeded' => 'The stack status is CREATE_COMPLETE and its Outputs tab lists EC2InstancePublicURL.',
			'wizardReachable' => 'Opening the EC2InstancePublicURL value in a browser loads the Installation Wizard.',
			'fullInstall'     => 'After the wizard and DNS: the sign-in link in the confirmation email opens the platform, every EKS pod is Running, the OpenSearch domain is Active, and RDS, ElastiCache and MSK report available.',
			'healthCheckEndpoint' => unconfirmed( 'No public health-check endpoint is published. Verify with the CloudFormation Outputs and the wizard URL loading.' ),
			'docs'            => HELP_BASE . '/support/home',
		),
		'recovery'     => array(
			'failures' => array(
				array( 'symptom' => 'Wizard URL does not load', 'cause' => 'The installer EC2 instance is not running yet or has stopped', 'fix' => 'In the EC2 console check the instance state, start it if stopped, then reload the URL.' ),
				array( 'symptom' => 'Stack creation fails or rolls back', 'cause' => 'Stack parameters, missing AWS permissions (including the IAM acknowledgement) or an exhausted service quota', 'fix' => 'Read the stack Events tab for the first failed resource, correct the parameter, permission or quota, then delete the failed stack and launch again.' ),
				array( 'symptom' => 'Install pauses or does not progress', 'cause' => 'A service quota limit was reached', 'fix' => 'Raise the quota in Service Quotas (EC2, RDS, EKS, ElastiCache, OpenSearch, NAT Gateway, VPC) and continue.' ),
				array( 'symptom' => 'Platform domain does not respond after install', 'cause' => 'Load balancer targets failing health checks or a blocking security group', 'fix' => 'In the EC2 console check the target group health and the security groups on the load balancer.' ),
			),
			'support' => array( 'email' => 'support@personalisationhub.com', 'helpCentre' => HELP_BASE . '/support/home', 'videoWalkthrough' => 'https://www.youtube.com/watch?v=DjFYzLK4E24' ),
			'teardown' => array(
				'Delete the CloudFormation stack in the AWS console (this also cancels usage billing; there are no refunds)',
				'If the Installation Wizard already created the platform, remove its resources through the platform\'s own lifecycle controls or contact support first: the stack alone does not own them',
				'Confirm in the console that the stack is DELETE_COMPLETE and the VPC and installer instance are gone',
			),
			'teardownStatus' => 'partly-confirmed',
			'teardownNote'   => 'Deleting the stack is the documented way to cancel. A full, verified teardown sequence for a completed wizard install is not published yet.',
		),
		'handOff'      => 'The Installation Wizard runs in the retailer\'s own AWS environment and is completed by a browser agent there. It is out of scope for this spec and handled separately. Stop at the EC2InstancePublicURL output.',
		'unconfirmed'  => array(
			'CloudFormation template URL',
			'least-privilege IAM policy JSON',
			'full per-region list',
			'numeric service quota minimums',
			'template parameters beyond stack name, ResourcePrefix and the three CIDR fields',
			'health-check endpoint',
			'single estimated running-cost figure',
		),
		'source'       => 'AWS Marketplace listing ' . FREE_TRIAL_URL . ' (checked 4 Nov 2026) and the Personalisation Hub Help Centre install articles.',
	);
}

/** Every path in $spec whose value is an "unconfirmed" item, as dotted keys. Used by tests. */
function unconfirmed_paths( array $spec, $prefix = '' ) {
	$out = array();
	foreach ( $spec as $k => $v ) {
		if ( ! is_array( $v ) ) {
			continue;
		}
		$p = $prefix . $k;
		if ( ( $v['status'] ?? '' ) === 'unconfirmed' ) {
			$out[ $p ] = $v;
		} else {
			$out = array_merge( $out, unconfirmed_paths( $v, $p . '.' ) );
		}
	}
	return $out;
}

/** The spec as markdown, built from the same array so text and structuredContent never differ. */
function installation_spec_md( array $s ) {
	$m  = $s['marketplace'];
	$md = "# Install Personalisation Hub in your own AWS account\n\n" . $s['summary'] . "\n\n";
	$md .= "## Human approval required\n\n";
	foreach ( $s['humanApproval']['steps'] as $x ) {
		$md .= "- $x\n";
	}
	$md .= $s['humanApproval']['note'] . ' EULA: ' . $s['humanApproval']['eulaUrl'] . "\n\n";
	$md .= "## AWS Marketplace\n\n- Listing: {$m['listingUrl']}\n- Listing ID: {$m['listingId']}\n- Product ID: {$m['productId']}\n- Subscribe: {$m['subscribeUrl']}\n";
	if ( $m['trackedTrialUrl'] ) {
		$md .= "- Free trial link (tracked): {$m['trackedTrialUrl']}\n";
	}
	$md .= "- Private offer: {$m['privateOfferUrl']}\n- Delivery: {$m['deliveryMethod']}, option \"{$m['deliveryOption']}\", version {$m['latestVersion']}, {$m['operatingSystem']}\n\n";
	$md .= "## Pricing (USD)\n\n" . $s['pricing']['freeTrial'] . "\n\n";
	foreach ( $s['pricing']['dimensions'] as $d ) {
		$md .= "- {$d['name']}: \${$d['usd']} per {$d['unit']}\n";
	}
	$md .= "\n" . $s['pricing']['awsInfrastructure'] . ' ' . $s['pricing']['refunds'] . "\n\n";
	$md .= "## Prerequisites\n\n" . $s['prerequisites']['awsAccount'] . "\n\n";
	foreach ( $s['prerequisites']['permissionsSummary'] as $x ) {
		$md .= "- $x\n";
	}
	$md .= "\nIAM policy JSON: UNCONFIRMED. " . $s['prerequisites']['iamPolicy']['note'] . "\n\nRegions: " . $s['prerequisites']['regions']['summary'] . ' ' . $s['prerequisites']['regions']['note'] . "\n\nService quotas: " . $s['prerequisites']['serviceQuotas']['note'] . ' Check: ' . implode( ', ', $s['prerequisites']['serviceQuotas']['check'] ) . ".\n\nEstimated running cost: UNCONFIRMED. " . $s['pricing']['estimatedRunningCost']['note'] . "\n\n";
	$md .= "## CloudFormation template\n\nTemplate URL: UNCONFIRMED. " . $s['template']['url']['note'] . "\n\nLaunch steps:\n\n";
	foreach ( $s['template']['launchSteps'] as $i => $x ) {
		$md .= ( $i + 1 ) . ". $x\n";
	}
	$md .= "\nParameters:\n\n";
	foreach ( $s['template']['parameters'] as $p ) {
		$md .= "- {$p['name']} ({$p['type']}" . ( $p['permanent'] ? ', permanent' : '' ) . "): {$p['description']} Rules: {$p['validation']}\n";
	}
	$md .= "\n" . $s['template']['parametersNote'] . "\n\n## Deployment\n\n- Stack duration: " . $s['deployment']['stackDuration'] . "\n- Total: " . $s['deployment']['totalInstallTime'] . "\n";
	foreach ( $s['deployment']['resourcesCreatedByStack'] as $x ) {
		$md .= "- Stack creates: $x\n";
	}
	foreach ( $s['deployment']['outputs'] as $o ) {
		$md .= "- Output {$o['key']}: {$o['description']}\n";
	}
	$md .= "\n## Verification\n\n- " . $s['verification']['stackSucceeded'] . "\n- " . $s['verification']['wizardReachable'] . "\n- " . $s['verification']['fullInstall'] . "\n- Health-check endpoint: UNCONFIRMED. " . $s['verification']['healthCheckEndpoint']['note'] . "\n\n## Recovery\n\n";
	foreach ( $s['recovery']['failures'] as $f ) {
		$md .= "- {$f['symptom']}: {$f['cause']}. Fix: {$f['fix']}\n";
	}
	$md .= "\nTeardown:\n\n";
	foreach ( $s['recovery']['teardown'] as $i => $x ) {
		$md .= ( $i + 1 ) . ". $x\n";
	}
	$md .= "\n" . $s['recovery']['teardownNote'] . ' Support: ' . $s['recovery']['support']['email'] . ' / ' . $s['recovery']['support']['helpCentre'] . "\n\n## Hand-off\n\n" . $s['handOff'] . "\n\n## Not yet confirmed\n\n";
	foreach ( $s['unconfirmed'] as $x ) {
		$md .= "- $x\n";
	}
	return $md;
}
