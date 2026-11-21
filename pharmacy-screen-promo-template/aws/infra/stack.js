"use strict";

// The Pharmacy Screen Promo Template in the retailer's own AWS account, next
// to their Personalisation Hub instance. One CloudFormation stack:
//
//   CloudFront (one HTTPS domain)
//     /*                       S3 site bucket (screen page, admin editor), Origin Access Control
//     /pharmacyScreen/media/*  S3 media bucket (logos, backgrounds), Origin Access Control
//     /api/screens/*           API Gateway, cached up to 60 s as the API's Cache-Control says
//     /api/*                   API Gateway, not cached
//   API Gateway HTTP API -> two Lambda functions (optionally inside the retailer's VPC)
//     ConfigApi   /api/health, /api/screens/**, /api/admin/**           (lambda/config-api.js)
//     PhApi       /api/settings/ph-api[/**], /api/device/**             (lambda/ph-proxy.js)
//   DynamoDB table        config records, audit logs, published screens, PH API settings
//   KMS key               wraps the PH API token's data key (90-day rotation); only PhApi may use it
//   Cognito user pool     admin sign-in, group "admin" (or the retailer's own OIDC provider instead)
//   Secrets Manager       the value CloudFront sends API Gateway, so PhApi can trust the viewer address
//
// Parameters: infra/params.js. Deploy and tear down: scripts/deploy.mjs.
// Everything is deleted with the stack unless retainData is set, which keeps
// the table, the media bucket, the KMS key and the user pool.

const fs = require("node:fs");
const nodePath = require("node:path");
const cdk = require("aws-cdk-lib");
const s3 = require("aws-cdk-lib/aws-s3");
const s3deploy = require("aws-cdk-lib/aws-s3-deployment");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const kms = require("aws-cdk-lib/aws-kms");
const lambda = require("aws-cdk-lib/aws-lambda");
const logs = require("aws-cdk-lib/aws-logs");
const apigw = require("aws-cdk-lib/aws-apigatewayv2");
const integrations = require("aws-cdk-lib/aws-apigatewayv2-integrations");
const cognito = require("aws-cdk-lib/aws-cognito");
const ec2 = require("aws-cdk-lib/aws-ec2");
const acm = require("aws-cdk-lib/aws-certificatemanager");
const route53 = require("aws-cdk-lib/aws-route53");
const route53Targets = require("aws-cdk-lib/aws-route53-targets");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");

const { Duration, RemovalPolicy, CfnOutput } = cdk;

const PH_ROUTES = ["/api/settings/ph-api", "/api/settings/ph-api/{proxy+}", "/api/device/{proxy+}"];
const CONFIG_ROUTES = ["/api/health", "/api/screens/{proxy+}", "/api/admin/{proxy+}"];
const { STORE_ROOT } = require("./constants");
const { adminConfig, adminConfigJs } = require("./admin-config");

// CloudFront viewer-request function: "/" goes to the admin editor (as on our
// Firebase Hosting site), "/admin" gets its slash, and a directory URL serves
// its index.html (an S3 origin behind Origin Access Control has no index
// documents of its own).
const SITE_ROUTER = `function handler(event) {
  var r = event.request;
  var u = r.uri;
  if (u === '/' || u === '/admin') {
    return { statusCode: 302, statusDescription: 'Found', headers: { location: { value: '/admin/' } } };
  }
  if (u.charAt(u.length - 1) === '/') r.uri = u + 'index.html';
  return r;
}`;

class PharmacyScreenStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const p = props.params;
    const keepData = p.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const name = (suffix) => `${p.stackName}-${suffix}`;

    // ── data ────────────────────────────────────────────────────────────
    const table = new dynamodb.Table(this, "ConfigTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: p.retainData,
      removalPolicy: keepData,
    });

    const tokenKey = new kms.Key(this, "PhApiTokenKey", {
      description: `${p.stackName}: wraps the data key that encrypts the Personalisation Hub API token`,
      enableKeyRotation: true,
      rotationPeriod: Duration.days(90),
      pendingWindow: Duration.days(7),
      alias: `alias/${p.stackName.toLowerCase()}-ph-api-token`,
      removalPolicy: keepData,
    });

    const bucketBase = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    };
    // Static files only, rebuilt by every deploy: always deleted with the stack.
    const siteBucket = new s3.Bucket(this, "SiteFiles", { ...bucketBase, removalPolicy: RemovalPolicy.DESTROY, autoDeleteObjects: true });
    const mediaBucket = new s3.Bucket(this, "MediaFiles", { ...bucketBase, removalPolicy: keepData, autoDeleteObjects: !p.retainData });

    // CloudFront sends this to API Gateway on every request; PhApi trusts the
    // viewer address only on requests that carry it (lambda/apigw.js).
    const originVerify = new secretsmanager.Secret(this, "OriginVerify", {
      description: `${p.stackName}: header value CloudFront adds to API requests`,
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ── network (optional) ──────────────────────────────────────────────
    const vpcProps = {};
    if (p.vpcId) {
      const vpc = ec2.Vpc.fromLookup(this, "Vpc", { vpcId: p.vpcId });
      const subnets = p.subnetIds.length
        ? { subnets: p.subnetIds.map((sid, i) => ec2.Subnet.fromSubnetId(this, `Subnet${i}`, sid)) }
        : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };
      const securityGroups = p.securityGroupIds.length
        ? p.securityGroupIds.map((gid, i) => ec2.SecurityGroup.fromSecurityGroupId(this, `Sg${i}`, gid))
        : [new ec2.SecurityGroup(this, "FunctionsSg", { vpc, allowAllOutbound: true, description: `${p.stackName} API functions` })];
      Object.assign(vpcProps, { vpc, vpcSubnets: subnets, securityGroups });
      if (p.vpcEndpoints) {
        vpc.addGatewayEndpoint("S3Endpoint", { service: ec2.GatewayVpcEndpointAwsService.S3 });
        vpc.addGatewayEndpoint("DynamoDbEndpoint", { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB });
        vpc.addInterfaceEndpoint("KmsEndpoint", { service: ec2.InterfaceVpcEndpointAwsService.KMS, subnets, securityGroups, privateDnsEnabled: true });
      }
    }

    // ── API ─────────────────────────────────────────────────────────────
    const httpApi = new apigw.HttpApi(this, "Api", { apiName: name("api"), description: `${p.stackName}: config API and PH API proxy` });
    const stage = httpApi.defaultStage && httpApi.defaultStage.node.defaultChild;
    if (stage) stage.defaultRouteSettings = { throttlingBurstLimit: 400, throttlingRateLimit: 200 };
    const apiHost = cdk.Fn.select(2, cdk.Fn.split("/", httpApi.apiEndpoint));

    // ── site (CloudFront) ───────────────────────────────────────────────
    const headers = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.SAME_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: false, override: true },
      },
    });
    const apiOrigin = new origins.HttpOrigin(apiHost, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      readTimeout: Duration.seconds(30),
      customHeaders: { "x-origin-verify": originVerify.secretValue.unsafeUnwrap() },
    });
    // The public screen config: the API answers Cache-Control max-age=15, which
    // this policy honours (up to 60 s), keyed by path and ?promo= only.
    const screensCache = new cloudfront.CachePolicy(this, "ScreensCache", {
      comment: `${p.stackName}: published screen config`,
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(60),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.allowList("promo"),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
    const router = new cloudfront.Function(this, "SiteRouter", {
      code: cloudfront.FunctionCode.fromInline(SITE_ROUTER),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: `${p.stackName}: / -> /admin/, directory index`,
    });
    const https = cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS;
    const distribution = new cloudfront.Distribution(this, "Site", {
      comment: `${p.stackName}: pharmacy screen and admin`,
      domainNames: p.domainName ? [p.domainName] : undefined,
      certificate: p.certificateArn ? acm.Certificate.fromCertificateArn(this, "Certificate", p.certificateArn) : undefined,
      minimumProtocolVersion: p.certificateArn ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021 : undefined,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: https,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        functionAssociations: [{ function: router, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        "pharmacyScreen/media/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket),
          viewerProtocolPolicy: https,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: headers,
        },
        "api/screens/*": {
          origin: apiOrigin,
          viewerProtocolPolicy: https,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: screensCache,
          responseHeadersPolicy: headers,
        },
        "api/*": {
          origin: apiOrigin,
          viewerProtocolPolicy: https,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: headers,
        },
      },
    });
    const siteUrl = p.domainName ? `https://${p.domainName}` : `https://${distribution.distributionDomainName}`;
    const adminUrl = `${siteUrl}/admin/`;

    if (p.hostedZoneId) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", { hostedZoneId: p.hostedZoneId, zoneName: p.hostedZoneName });
      const target = route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution));
      new route53.ARecord(this, "SiteA", { zone, recordName: p.domainName, target });
      new route53.AaaaRecord(this, "SiteAaaa", { zone, recordName: p.domainName, target });
    }

    // ── admin sign-in ───────────────────────────────────────────────────
    let oidc;
    let userPool = null;
    if (p.oidcIssuer) {
      oidc = {
        issuer: p.oidcIssuer,
        clientId: p.oidcClientId,
        authorizeUrl: p.oidcAuthorizeUrl,
        tokenUrl: p.oidcTokenUrl,
        logoutUrl: p.oidcLogoutUrl || null,
        logoutParam: "post_logout_redirect_uri",
        jwksUri: p.oidcJwksUri || "",
      };
    } else {
      userPool = new cognito.UserPool(this, "AdminUsers", {
        userPoolName: name("admins"),
        selfSignUpEnabled: false,
        signInAliases: { email: true },
        autoVerify: { email: true },
        standardAttributes: { email: { required: true, mutable: true } },
        passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false },
        mfa: cognito.Mfa.OPTIONAL,
        mfaSecondFactor: { otp: true, sms: false },
        accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
        deletionProtection: p.retainData,
        removalPolicy: keepData,
      });
      new cognito.CfnUserPoolGroup(this, "AdminGroup", {
        userPoolId: userPool.userPoolId,
        groupName: p.adminValue,
        description: "May open the pharmacy screen admin editor and change PH API settings",
      });
      const domain = userPool.addDomain("SignInDomain", {
        cognitoDomain: { domainPrefix: p.cognitoDomainPrefix || cdk.Fn.join("-", [p.stackName.toLowerCase(), cdk.Aws.ACCOUNT_ID]) },
      });
      const client = userPool.addClient("AdminEditor", {
        userPoolClientName: name("admin-editor"),
        generateSecret: false,
        authFlows: {},
        preventUserExistenceErrors: true,
        supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
        idTokenValidity: Duration.hours(1),
        accessTokenValidity: Duration.hours(1),
        refreshTokenValidity: Duration.hours(12),
        oAuth: {
          flows: { authorizationCodeGrant: true },
          scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
          callbackUrls: [adminUrl],
          logoutUrls: [adminUrl],
        },
      });
      const base = domain.baseUrl();
      oidc = {
        issuer: `https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com/${userPool.userPoolId}`,
        clientId: client.userPoolClientId,
        authorizeUrl: `${base}/oauth2/authorize`,
        tokenUrl: `${base}/oauth2/token`,
        logoutUrl: `${base}/logout`,
        logoutParam: "logout_uri",
        jwksUri: "",
      };
    }

    // ── functions ───────────────────────────────────────────────────────
    const code = lambda.Code.fromAsset(p.lambdaAsset);
    const authEnv = {
      PS_OIDC_ISSUER: oidc.issuer,
      PS_OIDC_AUDIENCE: oidc.clientId,
      PS_OIDC_JWKS_URI: oidc.jwksUri,
      PS_ADMIN_CLAIM: p.adminClaim,
      PS_ADMIN_VALUE: p.adminValue,
    };
    const fn = (id, handler, environment, description) =>
      new lambda.Function(this, id, {
        functionName: name(id),
        description,
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        code,
        handler,
        memorySize: 256,
        timeout: Duration.seconds(30),
        environment: { NODE_OPTIONS: "--enable-source-maps", ...environment },
        logGroup: new logs.LogGroup(this, `${id}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: keepData }),
        ...vpcProps,
      });

    const configFn = fn("ConfigApi", "aws/lambda/config-api.handler", {
      PS_TABLE: table.tableName,
      PS_ROOT: STORE_ROOT,
      PS_MEDIA_BUCKET: mediaBucket.bucketName,
      PS_MEDIA_BASE_URL: siteUrl,
      PS_ALLOWED_ORIGINS: siteUrl,
      ...authEnv,
    }, "Pharmacy screen config API: pharmacies, promotions, templates, services, published screen config");
    const phFn = fn("PhApi", "aws/lambda/ph-proxy.handler", {
      PH_TABLE: table.tableName,
      PH_ROOT: STORE_ROOT,
      PH_TOKEN_KMS_KEY: tokenKey.keyArn,
      PH_API_DEFAULT_BASE_URL: p.phApiBaseUrl,
      PH_ALLOWED_ORIGINS: siteUrl,
      PH_TRUSTED_PROXY_HOPS: "2",
      PS_ORIGIN_VERIFY: originVerify.secretValue.unsafeUnwrap(),
      ...authEnv,
    }, "Pharmacy screen PH API settings (encrypted token) and Location API proxy");

    table.grantReadWriteData(configFn);
    mediaBucket.grantPut(configFn);
    mediaBucket.grantDelete(configFn);
    table.grantReadWriteData(phFn);
    tokenKey.grantEncryptDecrypt(phFn);

    const configInt = new integrations.HttpLambdaIntegration("ConfigApiIntegration", configFn);
    const phInt = new integrations.HttpLambdaIntegration("PhApiIntegration", phFn);
    for (const path of CONFIG_ROUTES) httpApi.addRoutes({ path, methods: [apigw.HttpMethod.ANY], integration: configInt });
    for (const path of PH_ROUTES) httpApi.addRoutes({ path, methods: [apigw.HttpMethod.ANY], integration: phInt });

    // ── static files + the admin editor's sign-in config ────────────────
    const editorConfig = adminConfig({
      clientId: oidc.clientId,
      authorizeUrl: oidc.authorizeUrl,
      tokenUrl: oidc.tokenUrl,
      logoutUrl: oidc.logoutUrl,
      logoutParam: oidc.logoutParam,
      scopes: p.oidcScopes,
    });
    // The screen's fingerprinted files (assets/: scripts, stylesheets, fonts, the Christmas photo; their names are
    // the hash of their content, scripts/deploy.mjs buildShell) are uploaded first and kept by browsers and the CDN
    // for a year: a name never changes what it answers. Earlier builds' files are kept (no prune), so a player still
    // on the previous page can finish loading it. Everything else (the page, sw.js, the admin editor) is no-cache,
    // and uploaded after, so a page never names a file that is not there yet.
    // (A site staged empty, as for cdk destroy, has no assets/.)
    const assetsDir = nodePath.join(p.siteAsset, "assets");
    const assetUpload = fs.existsSync(assetsDir) && new s3deploy.BucketDeployment(this, "SiteAssetsUpload", {
      sources: [s3deploy.Source.asset(assetsDir)],
      destinationBucket: siteBucket,
      destinationKeyPrefix: "assets/",
      cacheControl: [s3deploy.CacheControl.fromString("public, max-age=31536000, immutable")],
      prune: false,
      memoryLimit: 512,
    });
    const siteUpload = new s3deploy.BucketDeployment(this, "SiteUpload", {
      sources: [
        s3deploy.Source.asset(p.siteAsset, { exclude: ["admin/config.js", "assets/*"] }),
        s3deploy.Source.data("admin/config.js", adminConfigJs(editorConfig, (v) => this.toJsonString(v))),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
      cacheControl: [s3deploy.CacheControl.noCache()],
      // assets/ is the upload above's: excluded files are neither uploaded nor pruned here.
      exclude: ["assets/*"],
      prune: true,
      memoryLimit: 512,
    });
    if (assetUpload) siteUpload.node.addDependency(assetUpload);

    // ── outputs (scripts/deploy.mjs prints them) ────────────────────────
    const out = (id, value, description) => new CfnOutput(this, id, { value, description });
    out("SiteUrl", siteUrl, "Screen and admin origin");
    out("AdminUrl", adminUrl, "Admin editor");
    out("ScreenUrl", `${siteUrl}/pharmacy-screen.html?device=TEST&promo=morning&orientation=portrait&mockapi=1`, "Screen with mock data");
    out("CampaignUrlTemplate", `${siteUrl}/pharmacy-screen.html?device=\${UniqueDeviceID}&promo=morning&orientation=portrait`, "Campaign URL for Personalisation Hub");
    out("ApiUrl", `${siteUrl}/api`, "API through CloudFront");
    out("HealthUrl", `${siteUrl}/api/health`, "Health check");
    out("ApiGatewayUrl", httpApi.apiEndpoint, "API Gateway endpoint (CloudFront's origin)");
    out("DistributionId", distribution.distributionId, "CloudFront distribution");
    out("DistributionDomain", distribution.distributionDomainName, "CloudFront domain (CNAME target for a custom domain)");
    out("TableName", table.tableName, "DynamoDB table");
    out("MediaBucket", mediaBucket.bucketName, "S3 media bucket");
    out("SiteBucket", siteBucket.bucketName, "S3 site bucket");
    out("TokenKeyArn", tokenKey.keyArn, "KMS key that wraps the PH API token's data key");
    out("OidcIssuer", oidc.issuer, "Admin sign-in issuer");
    out("AdminClientId", oidc.clientId, "Admin editor's client id");
    out("AdminClaim", `${p.adminClaim}=${p.adminValue}`, "ID token claim that grants the admin role");
    out("ConfigApiFunction", configFn.functionName, "Config API function");
    out("PhApiFunction", phFn.functionName, "PH API proxy function");
    if (userPool) out("UserPoolId", userPool.userPoolId, "Cognito user pool for admins");
    out("RetainData", String(p.retainData), "Whether data resources outlive the stack");
  }
}

module.exports = { PharmacyScreenStack, PH_ROUTES, CONFIG_ROUTES, SITE_ROUTER, STORE_ROOT };
