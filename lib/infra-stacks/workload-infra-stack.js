const { Stack, CfnOutput, } = require('aws-cdk-lib');
const ec2 = require('aws-cdk-lib/aws-ec2')
const iam = require('aws-cdk-lib/aws-iam')
const autoscaling = require('aws-cdk-lib/aws-autoscaling')
const ecs = require('aws-cdk-lib/aws-ecs')
const logs = require('aws-cdk-lib/aws-logs')
const path = require('path')
const fs = require('fs')

class WorkloadInfraStack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    const {
      privateWorkloadSgId,
      privateSubnetIds
    } = props

    // ECS Workload  Cluster

    const primaryCluster = new ecs.CfnCluster(this, 'PrimaryWorkloadCluster', {
      clusterName: 'PrimaryWorkloadCluster',
      // configuration: {
      //   executeCommandConfiguration: {
      //     logConfiguration: {
      //       cloudWatchLogGroupName: primaryEcsLogs.logGroupName
      //     },
      //     logging: 'OVERRIDE'
      //   },
      // },
      serviceConnectDefaults: {
        namespace: 'internal.service'
      }
    })

    new CfnOutput(this, 'PrimaryWorkloadClusterArn', {
      value: primaryCluster.attrArn,
      exportName: 'PrimaryWorkloadClusterArn',
      description: `Primary Workload Cluster Arn`
    })

    new CfnOutput(this, 'PrimaryWorkloadClusterName', {
      value: primaryCluster.clusterName,
      exportName: 'PrimaryWorkloadClusterName',
      description: `Primary Workload Cluster Name`
    })

    //Instance Profile for ECS Instances
    const assumeRolePolicyDocument = {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Principal": {
            "Service": "ec2.amazonaws.com"
          },
          "Action": "sts:AssumeRole"
        }
      ]
    }

    const instanceProfileRoleDocument = {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Action": [
            "ecs:DeregisterContainerInstance",
            "ecs:RegisterContainerInstance",
            "ecs:Submit*"
          ],
          "Resource": primaryCluster.attrArn,
          "Effect": "Allow"
        },
        {
          "Condition": {
            "ArnEquals": {
              "ecs:cluster": primaryCluster.attrArn
            }
          },
          "Action": [
            "ecs:Poll",
            "ecs:StartTelemetrySession"
          ],
          "Resource": "*",
          "Effect": "Allow"
        },
        {
          "Action": [
            "ecr:GetAuthorizationToken",
            "ecr:BatchGetImage",
            "ec2:DescribeTags",
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecs:TagResource",
            "ecs:DiscoverPollEndpoint",
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          "Resource": "*",
          "Effect": "Allow"
        }
      ]
    }

    const primaryWorkloadInstanceProfileRole = new iam.CfnRole(this, 'PrimaryWorkloadInstanceProfileRole', {
      assumeRolePolicyDocument: assumeRolePolicyDocument,
      description: 'Provide access to Register and Deregister EC2 Instance with ECS Cluster',
      policies: [{ policyDocument: instanceProfileRoleDocument, policyName: 'PrimaryWorkloadInstanceAccess' }],
      roleName: 'PrimaryWorkloadInstanceProfileRole',
      managedPolicyArns: ['arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore']
    })

    const primaryWorkloadInstanceProfile = new iam.CfnInstanceProfile(this, 'PrimaryWorkloadInstanceProfile', {
      roles: [primaryWorkloadInstanceProfileRole.roleName],
      instanceProfileName: 'PrimaryWorkloadInstanceProfile'
    })

    const filePath = path.resolve(__dirname, '../../scripts/ecs-al-script.txt');

    // Launch Templates 
    const privatePrimaryAsgLaunchTemplate = new ec2.CfnLaunchTemplate(this, 'PrivatePrimaryAsgLaunchTemplate', {
      launchTemplateName: 'PrivatePrimaryAsgLaunchTemplate',
      launchTemplateData: {
        imageId: 'ami-081253476e0f149f9', //ECS HVM
        instanceType: 'c6g.xlarge',
        securityGroupIds: [privateWorkloadSgId],
        userData: fs.readFileSync(filePath, 'base64'),
        iamInstanceProfile: {
          arn: primaryWorkloadInstanceProfile.attrArn
        },
        blockDeviceMappings: [{
          deviceName: '/dev/xvda',
          ebs: {
            deleteOnTermination: true,
            encrypted: true,
            volumeSize: 30,
            volumeType: 'gp3',
            iops: 3000,
            throughput: 125
          }
        }],
      }
    })


    const privatePrimaryInstanceAsg = new autoscaling.CfnAutoScalingGroup(this, 'PrivatePrimaryInstanceAsg', {
      minSize: '0',
      maxSize: '5',
      autoScalingGroupName: 'PrivatePrimaryInstanceAsg',
      capacityRebalance: true,
      mixedInstancesPolicy: {
        instancesDistribution: {
          onDemandPercentageAboveBaseCapacity: 100
        },
        launchTemplate: {
          launchTemplateSpecification: {
            launchTemplateName: privatePrimaryAsgLaunchTemplate.launchTemplateName,
            version: privatePrimaryAsgLaunchTemplate.attrLatestVersionNumber
          }
        },
      },
      vpcZoneIdentifier: privateSubnetIds,
      newInstancesProtectedFromScaleIn: true,
      tags: [
        {
          key: 'AmazonECSManaged',
          value: "true",
          propagateAtLaunch: true
        }
      ]
    })

    // ECS Capacity Providers
    const privatePrimaryCapacityProvider = new ecs.CfnCapacityProvider(this, 'PrivatePrimaryCapacityProvider', {
      autoScalingGroupProvider: {
        autoScalingGroupArn: privatePrimaryInstanceAsg.ref,
        managedScaling: {
          targetCapacity: 100,
          status: 'ENABLED',
        },
        managedTerminationProtection: 'ENABLED'
      },
      name: 'PrivatePrimaryCapacityProvider',
    })

    new CfnOutput(this, 'privatePrimaryCapacityProviderName', {
      value: privatePrimaryCapacityProvider.name,
      exportName: 'PrimaryWorkloadClusterArn',
      description: `Private Primary Capacity Provider Name`
    })

    new ecs.CfnClusterCapacityProviderAssociations(this, 'AssociateCapacityProviders', {
      capacityProviders: [privatePrimaryCapacityProvider.name],
      cluster: primaryCluster.clusterName,
      defaultCapacityProviderStrategy: [{
        capacityProvider: privatePrimaryCapacityProvider.name,
        base: 2500,
        weight: 1,
      }]
    })

  }
}

module.exports = { WorkloadInfraStack }
