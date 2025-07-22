const { Stack } = require('aws-cdk-lib');
const logs = require('aws-cdk-lib/aws-logs');
const ec2 = require('aws-cdk-lib/aws-ec2');
const ecs = require('aws-cdk-lib/aws-ecs');
const iam = require('aws-cdk-lib/aws-iam');
const elbv2 = require('aws-cdk-lib/aws-elasticloadbalancingv2');
const apiGwV2 = require('aws-cdk-lib/aws-apigatewayv2');
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const appscaling = require('aws-cdk-lib/aws-applicationautoscaling')

class DemoServiceStack extends Stack {
    /**
     *
     * @param {Construct} scope
     * @param {string} id
     * @param {StackProps=} props
     */
    constructor(scope, id, props) {
        super(scope, id, props);

        const {
            vpcId,
            ecsClusterArn,
            ecrRepoName,
            minTaskCount,
            maxTaskCount,
            containerMemHardLimitMib,
            containerMemSoftLimitMib,
            containerCpu,
            containerLogStreamPrefix,
            containerPort,
            vpcLinkId,
            httpApiId,
            httpApiCognitoAuthorizerId,
            imageVersion,
            logRetentionDuration,
            internalAlbMainListenerArn,
            targetGroupPriority,
            containerName,
            taskExecutionPolicyArn,
            internalAlbListenerArn,
            primaryCapacityProviderName,
            ecsClusterName,
            metricsNotificationTopicArn,
            memoryAlarmThreshold,
            cpuAlarmThreshold,
            serviceName
        } = props;


        const serviceLogGroup = new logs.CfnLogGroup(this, 'ServiceLogGroup', {
            logGroupName: 'Demo/LogGroup',
            retentionInDays: logRetentionDuration
        })

        const assumeRolePolicyDocument = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {
                        "Service": "ecs-tasks.amazonaws.com"
                    },
                    "Action": "sts:AssumeRole"
                }
            ]
        }

        const taskExecutionRole = new iam.CfnRole(this, 'DemoEcsTaskExecutionRole', {
            roleName: 'DemoTaskExecutionRole',
            assumeRolePolicyDocument: assumeRolePolicyDocument,
            managedPolicyArns: [taskExecutionPolicyArn]
        })

        // const servicePolicyDocument = {
        //     "Version": "2012-10-17",
        //     "Statement": [
        //         {
        //             "Action": [
        //                 "s3:GetObject",
        //                 "s3:PutObject"
        //             ],
        //             "Resource": [`${centralDeletableS3Bucket}/*`],
        //             "Effect": "Allow",
        //         },
        //         {
        //             "Action": [
        //                 "elasticfilesystem:*"
        //             ],
        //             "Resource": ["*"],
        //             "Effect": "Allow",
        //         }
        //     ]
        // }

        // const taskRole = new iam.CfnRole(this, 'DemoEcsTaskRole', {
        //     roleName: taskRoleName,
        //     assumeRolePolicyDocument: assumeRolePolicyDocument,
        //     policies: [
        //         {
        //             policyDocument: servicePolicyDocument,
        //             policyName: rolePolicyName
        //         }
        //     ]
        // })

        const taskDefinition = new ecs.CfnTaskDefinition(this, 'DemoEcsTaskDefinition', {
            family: 'DemoTaskDefinition',
            containerDefinitions: [
                {
                    image: `${Stack.of(this).account}.dkr.ecr.${Stack.of(this).region}.amazonaws.com/${ecrRepoName}:${imageVersion}`,
                    name: containerName,
                    cpu: containerCpu,
                    logConfiguration: {
                        logDriver: 'awslogs',
                        options: {
                            "awslogs-group": serviceLogGroup.logGroupName,
                            "awslogs-region": `${Stack.of(this).region}`,
                            "awslogs-stream-prefix": containerLogStreamPrefix
                        }
                    },
                    memory: containerMemHardLimitMib,
                    memoryReservation: containerMemSoftLimitMib,
                    portMappings: [
                        { containerPort: containerPort }
                    ]
                }
            ],
            networkMode: 'bridge',
            // taskRoleArn: taskRole.attrArn,
            executionRoleArn: taskExecutionRole.attrArn
        })

        const primaryTargetGroup = new elbv2.CfnTargetGroup(this, 'DemoServiceTG', {
            ipAddressType: 'ipv4',
            name: 'DemoServiceTG',
            protocol: 'HTTP',
            targetType: 'instance',
            vpcId,
            port: 80, // Port should be 80
            healthCheckPath: '/api/demo/v1/health'
        })

        let capacityProviderStrategy = [
            {
                base: minTaskCount,
                capacityProvider: primaryCapacityProviderName,
                weight: maxTaskCount
            }
            // {
            //     base: 0,
            //     capacityProvider: secondaryCapacityProviderName,
            //     weight: 99
            // }
        ]

        const service = new ecs.CfnService(this, 'DemoService', {
            capacityProviderStrategy,
            placementStrategies: [{
                type: 'binpack',
                field: 'cpu'
            }],
            cluster: ecsClusterArn,
            taskDefinition: taskDefinition.attrTaskDefinitionArn,
            loadBalancers: [{
                targetGroupArn: primaryTargetGroup.attrTargetGroupArn,
                containerName: containerName,
                containerPort: containerPort // Port should be 8080
            }],
            serviceName,
            healthCheckGracePeriodSeconds: 60
        })

        new elbv2.CfnListenerRule(this, 'ForwardToDemoService', {
            conditions: [
                {
                    field: 'path-pattern',
                    pathPatternConfig: {
                        values: ['/api/demo-service/*']
                    }
                }
            ],
            actions: [
                {
                    type: 'forward',
                    targetGroupArn: primaryTargetGroup.attrTargetGroupArn
                }
            ],
            priority: targetGroupPriority,
            listenerArn: internalAlbListenerArn
        })

        //CPU utilization alarm
        new cloudwatch.CfnAlarm(this, 'CpuAlarm', {
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            metricName: 'CPUUtilization',
            namespace: 'AWS/ECS',
            alarmActions: [metricsNotificationTopicArn],
            statistic: 'Maximum',
            period: 60,
            threshold: cpuAlarmThreshold,
            actionsEnabled: true,
            alarmDescription: `Notifies when the CPU reaches the maximum threshold of ${cpuAlarmThreshold}%.`,
            alarmName: "demo-service-cpu-metrics",
            dimensions: [
                {
                    name: 'ServiceName',
                    value: service.attrName
                },
                {
                    name: 'ClusterName',
                    value: ecsClusterName
                }
            ]
        })

        // Memory utilization alarm
        new cloudwatch.CfnAlarm(this, 'MemoryAlarm', {
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            metricName: 'MemoryUtilization',
            namespace: 'AWS/ECS',
            alarmActions: [metricsNotificationTopicArn],
            statistic: 'Maximum',
            period: 60,
            threshold: memoryAlarmThreshold,
            actionsEnabled: true,
            alarmDescription: `Notifies when the Memory reaches the maximum threshold of ${memoryAlarmThreshold}%.`,
            alarmName: "demo-service-memory-metrics",
            dimensions: [
                {
                    name: 'ServiceName',
                    value: service.attrName
                },
                {
                    name: 'ClusterName',
                    value: ecsClusterName
                }
            ]
        })

        // Service Routes 
        const backendIntegration = new apiGwV2.CfnIntegration(this, 'DemoServiceIntegration', {
            apiId: httpApiId,
            integrationType: 'HTTP_PROXY',
            connectionId: vpcLinkId,
            connectionType: 'VPC_LINK',
            integrationUri: internalAlbMainListenerArn,
            integrationMethod: 'ANY',
            payloadFormatVersion: '1.0'
        })

        // Internal ALB health check route
        new apiGwV2.CfnRoute(this, 'DemoServiceHealth', {
            apiId: httpApiId,
            routeKey: 'GET /api/demo-service/v1/health',
            target: `integrations/${backendIntegration.ref}`,
            authorizerId: httpApiCognitoAuthorizerId,
            authorizationType: 'JWT'
        })
    }
}

module.exports = { DemoServiceStack }