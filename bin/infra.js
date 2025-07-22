#!/usr/bin/env node

const cdk = require('aws-cdk-lib');
const logs = require('aws-cdk-lib/aws-logs')

const { NetworkInfraStack } = require('../lib/infra-stacks/network-infra-stack.js');
const { WorkloadInfraStack } = require('../lib/infra-stacks/workload-infra-stack.js');
const { SecurityStack } = require('../lib/infra-stacks/security-stack.js');
const { SnsNotificationStack } = require('../lib/infra-stacks/sns-notification-stack.js');
const { DemoServiceResourceStack } = require('../lib/service/service-resource-stack.js');
const { DemoServiceStack } = require('../lib/service/demo-service-stack.js');
const { PipelineStack } = require('../lib/service/pipeline-stack.js');

const app = new cdk.App();

const accDetails = { account: '', region: 'ap-south-1' }


const networkInfraProps = {
  env: accDetails,
  appDefaultCertificateArn: [{ certificateArn: '' }],
  apiGwDomain: 'api.demo.in',
  httpApiDomainCertArn: "arn:aws:acm:ap-south-1::certificate/",
  cognitoUserPoolClientId: cdk.Fn.importValue('CognitoUserPoolClientId'),
  cognitoUserPoolId: cdk.Fn.importValue('CognitoUserPoolId') 
}

const workloadInfraProps = {
  privateWorkloadSgId: cdk.Fn.importValue('PrimaryPrivateWorkloadSGId'),
  privateSubnetIds: [cdk.Fn.importValue('PrivateResourceSubnet1Id'), cdk.Fn.importValue('PrivateResourceSubnet2Id'), cdk.Fn.importValue('PrivateResourceSubnet3Id')]
}

const securityProps = {
  env: accDetails,
  primaryExternalAlbArns: cdk.Fn.importValue('PrimaryExternalAlbArn'),
  logRetention: logs.RetentionDays.ONE_WEEK
}

const snsNotificationProps = {
  env: accDetails,
  topicName: 'metrics-notification',
  email: 'alert@demo.in'
}

const serviceResourcesProps = {
  env: accDetails,
  ecrRepoName: 'demo-service-ecr-repo',
  imageCount: 20
}

const serviceProps = {
  env: accDetails,
  vpcId: cdk.Fn.importValue('PrimaryVpcId'),
  ecsClusterArn: cdk.Fn.importValue('PrimaryWorkloadClusterArn'),
  ecsClusterName: cdk.Fn.importValue('PrimaryWorkloadClusterName'),
  ecrRepoName: serviceResourcesProps.ecrRepoName,
  minTaskCount: 1,
  maxTaskCount: 5,
  containerMemHardLimitMib: 1959,
  containerMemSoftLimitMib: 1959,
  containerCpu: 1024,
  containerLogStreamPrefix: 'Demo',
  containerPort: 8080,
  vpcLinkId: cdk.Fn.importValue('PrimaryVpcLinkId'),
  httpApiId: cdk.Fn.importValue('primaryHttpApiId'),
  httpApiCognitoAuthorizerId: cdk.Fn.importValue('PrimaryHttpApiCognitoAuthorizerId'),
  imageVersion: app.node.tryGetContext('imgVer'),
  logRetentionDuration: 3,
  internalAlbListenerArn: cdk.Fn.importValue('PrimaryInternalAlbListenerArn'),
  metricsNotificationTopicArn: cdk.Fn.importValue('NotificationTopicArn'),
  targetGroupPriority: 1,
  taskExecutionPolicyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
  primaryCapacityProviderName: cdk.Fn.importValue('PrimaryWorkloadClusterArn'),
  containerName: 'DemoContainer',
  serviceName: 'DemoService',
  memoryAlarmThreshold: 75,
  cpuAlarmThreshold: 85
}

const environmentVariables = {
  AWS_ACCOUNT_ID: { value: accDetails.account },
  AWS_DEFAULT_REGION: { value: accDetails.region },
  KMS_KEY_ID: { value: '0ecdd329-7700-4ac2-b356-b5c6fff13839' }
}

const pipelineProps = {
  kmsKeyArn: cdk.Fn.importValue('KmsKeyArn'),
  pipelineArtifactBucketArn: cdk.Fn.importValue('ArtifactBucketArn'),
  environmentVariables,
  gitBranch: 'main',
  codeStarConnectionArn: cdk.Fn.importValue('CodeStarConnectionArn'),
  pipelineSnsArn: cdk.Fn.importValue('PipelineSnsArn'),
  ecsClusterName: serviceProps.ecrRepoName,
  encFilePath: '/.enc.env.production',
  repo: serviceResourcesProps.ecrRepoName,
  containerName: serviceProps.containerName,
  ecsServiceName: serviceProps.serviceName
}




const networkInfraStack = new NetworkInfraStack(app, 'NetworkInfraStack', networkInfraProps);
cdk.Tags.of(networkInfraStack).add("application-name", 'NetworkInfra');
cdk.Tags.of(networkInfraStack).add("environment-type", 'Demo');


const workloadInfraStack = new WorkloadInfraStack(app, 'WorkloadInfraStack', workloadInfraProps);
cdk.Tags.of(workloadInfraStack).add("application-name", 'WorkloadInfra');
cdk.Tags.of(workloadInfraStack).add("environment-type", 'Demo');

const securityStack = new SecurityStack(app, 'SecurityStack', securityProps);
cdk.Tags.of(securityStack).add("application-name", 'SecurityInfra');
cdk.Tags.of(securityStack).add("environment-type", 'Demo');

const snsNotificationStack = new SnsNotificationStack(app, 'SnsNotificationStack', snsNotificationProps);
cdk.Tags.of(snsNotificationStack).add("application-name", 'SnsNotification');
cdk.Tags.of(snsNotificationStack).add("environment-type", 'Demo');

const serviceResourcesStack = new DemoServiceResourceStack(app, 'ServiceResourcesStack', serviceResourcesProps);
cdk.Tags.of(serviceResourcesStack).add("application-name", 'ServiceResources');
cdk.Tags.of(serviceResourcesStack).add("environment-type", 'Demo');

const servicetack = new DemoServiceStack(app, 'ServiceStack', serviceProps);
cdk.Tags.of(servicetack).add("application-name", 'Service');
cdk.Tags.of(servicetack).add("environment-type", 'Demo');

const pipelineStack = new PipelineStack(app, 'PipelineStack', pipelineProps);
cdk.Tags.of(pipelineStack).add("application-name", 'Pipeline');
cdk.Tags.of(pipelineStack).add("environment-type", 'Demo');

