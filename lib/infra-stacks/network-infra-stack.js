const { Stack, Duration, Tags, CfnOutput } = require('aws-cdk-lib');
const ec2 = require('aws-cdk-lib/aws-ec2')
const logs = require('aws-cdk-lib/aws-logs')
const iam = require('aws-cdk-lib/aws-iam')
const elbv2 = require('aws-cdk-lib/aws-elasticloadbalancingv2')
const apigw_v2 = require('aws-cdk-lib/aws-apigatewayv2')
const s3 = require('aws-cdk-lib/aws-s3')

class NetworkInfraStack extends Stack {
    /**
     *
     * @param {Construct} scope
     * @param {string} id
     * @param {StackProps=} props
     */
    constructor(scope, id, props) {
        super(scope, id, props);

        const {
            appDefaultCertificateArn,
            httpApiDomainCertArn,
            cognitoUserPoolClientId,
            cognitoUserPoolId
        } = props

        // Primary VPC 
        const primaryVpc = new ec2.CfnVPC(this, 'PrimaryVpc', {
            cidrBlock: '10.0.0.0/16',
            enableDnsHostnames: true,
            enableDnsSupport: true,
            instanceTenancy: 'default',
            tags: [{ key: "Name", value: "primary-network" }]
        })

        new CfnOutput(this, 'PrimaryVpcId', {
            value: primaryVpc.attrVpcId,
            exportName: 'PrimaryVpcId',
            description: `Primary VPC Id`
        })

        // LogGroup for VPC Flow Logs
        const primaryVpcLogs = new logs.CfnLogGroup(this, 'PrimaryVpcLogs', {
            logGroupName: 'Primary/VPC/FlowLogs',
            retentionInDays: 1
        })

        const assumeRolePolicyDocument = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {
                        "Service": "vpc-flow-logs.amazonaws.com"
                    },
                    "Action": "sts:AssumeRole"
                }
            ]
        }

        const policyDocument = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": [
                        "logs:CreateLogGroup",
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    "Resource": primaryVpcLogs.attrArn,
                    "Effect": "Allow",
                }
            ]
        }

        const primaryNetworkFlowAccessRole = new iam.CfnRole(this, 'PrimaryNetworkFlowAccessRole', {
            roleName: 'PrimaryNetworkFlowAccessRole',
            assumeRolePolicyDocument,
            policies: [
                {
                    policyDocument,
                    policyName: 'PrimaryNetworkFlowAccessRole'
                }
            ],
            description: 'Provides access to VPC for CloudWatch Logs'
        })

        new ec2.CfnFlowLog(this, 'PrimaryNetworkFlowLogsAttach', {
            resourceId: primaryVpc.attrVpcId,
            resourceType: 'VPC',
            logGroupName: primaryVpcLogs.logGroupName,
            deliverLogsPermissionArn: primaryNetworkFlowAccessRole.attrArn,
            trafficType: 'ALL'
        })

        const primaryCentralNacl = new ec2.CfnNetworkAcl(this, 'PrimaryCentralNacl', {
            vpcId: primaryVpc.attrVpcId,
            tags: [{
                key: 'Name',
                value: 'Primary/VPC/NACL'
            }]
        })

        // Inbound rules
        new ec2.CfnNetworkAclEntry(this, 'PrimaryCentralNaclIngress-1', {
            networkAclId: primaryCentralNacl.attrId,
            protocol: -1,
            ruleAction: 'allow',
            ruleNumber: 100,
            cidrBlock: '0.0.0.0/0',
        })

        // Outbound rules
        new ec2.CfnNetworkAclEntry(this, 'PrimaryCentralNaclEgress-1', {
            networkAclId: primaryCentralNacl.attrId,
            protocol: -1,
            ruleAction: 'allow',
            ruleNumber: 100,
            cidrBlock: '0.0.0.0/0',
            egress: true
        })

        // Public Route Tables
        const primaryPublicRouteTable1 = new ec2.CfnRouteTable(this, 'PrimaryPublicRouteTable1', {
            vpcId: primaryVpc.attrVpcId,
            tags: [{ key: 'Name', value: 'Primary/VPC/RouteTable/Public-1' }]
        })
        const primaryPublicRouteTable2 = new ec2.CfnRouteTable(this, 'PrimaryPublicRouteTable2', {
            vpcId: primaryVpc.attrVpcId,
            tags: [{ key: 'Name', value: 'Primary/VPC/RouteTable/Public-2' }]
        })
        const primaryPublicRouteTable3 = new ec2.CfnRouteTable(this, 'PrimaryPublicRouteTable3', {
            vpcId: primaryVpc.attrVpcId,
            tags: [{ key: 'Name', value: 'Primary/VPC/RouteTable/Public-3' }]
        })

        // Private Route Tables
        const primaryPrivateRouteTable1 = new ec2.CfnRouteTable(this, 'PrimaryPrivateRouteTable1', {
            vpcId: primaryVpc.attrVpcId,
            tags: [{ key: 'Name', value: 'Primary/VPC/RouteTable/Private-1' }]
        })
        const primaryPrivateRouteTable2 = new ec2.CfnRouteTable(this, 'PrimaryPrivateRouteTable2', {
            vpcId: primaryVpc.attrVpcId,
            tags: [{ key: 'Name', value: 'Primary/VPC/RouteTable/Private-2' }]
        })
        const primaryPrivateRouteTable3 = new ec2.CfnRouteTable(this, 'PrimaryPrivateRouteTable3', {
            vpcId: primaryVpc.attrVpcId,
            tags: [{ key: 'Name', value: 'Primary/VPC/RouteTable/Private-3' }]
        })

        // Pubilc Subnets
        const publicSubnet1 = new ec2.CfnSubnet(this, 'PublicSubnet1', {
            vpcId: primaryVpc.attrVpcId,
            availabilityZone: 'ap-south-1a',
            cidrBlock: '10.0.0.0/25', // 128
            mapPublicIpOnLaunch: true,
            tags: [{ key: "Name", value: "Primary/VPC/Subnet/Public-1" }]
        })
        const publicSubnet2 = new ec2.CfnSubnet(this, 'PublicSubnet2', {
            vpcId: primaryVpc.attrVpcId,
            availabilityZone: 'ap-south-1b',
            cidrBlock: '10.0.0.128/25', // 128
            mapPublicIpOnLaunch: true,
            tags: [{ key: "Name", value: "Primary/VPC/Subnet/Public-2" }]
        })
        const publicSubnet3 = new ec2.CfnSubnet(this, 'PublicSubnet3', {
            vpcId: primaryVpc.attrVpcId,
            availabilityZone: 'ap-south-1c',
            cidrBlock: '10.0.1.0/25', // 128
            mapPublicIpOnLaunch: true,
            tags: [{ key: "Name", value: "Primary/VPC/Subnet/Public-3" }]
        })

        // Resource Subnets
        const privateResourceSubnet1 = new ec2.CfnSubnet(this, 'PrivateResourceSubnet1', {
            vpcId: primaryVpc.attrVpcId,
            availabilityZone: 'ap-south-1a',
            cidrBlock: '10.0.2.0/24', // 256
            tags: [{ key: "Name", value: "Primary/VPC/Subnet/PrivateResource-1" }]
        })
        new CfnOutput(this, 'PrivateResourceSubnet1Id', {
            value: privateResourceSubnet1.attrSubnetId,
            exportName: 'PrivateResourceSubnet1Id',
            description: 'The ID of Primary Private Workload Subnet-1'
        })

        const privateResourceSubnet2 = new ec2.CfnSubnet(this, 'PrivateResourceSubnet2', {
            vpcId: primaryVpc.attrVpcId,
            availabilityZone: 'ap-south-1b',
            cidrBlock: '10.0.3.0/24', // 256
            tags: [{ key: "Name", value: "Primary/VPC/Subnet/PrivateResource-2" }]
        })
        new CfnOutput(this, 'PrivateResourceSubnet2Id', {
            value: privateResourceSubnet2.attrSubnetId,
            exportName: 'PrivateResourceSubnet2Id',
            description: 'The ID of Primary Private Workload Subnet-2'
        })

        const privateResourceSubnet3 = new ec2.CfnSubnet(this, 'PrivateResourceSubnet3', {
            vpcId: primaryVpc.attrVpcId,
            availabilityZone: 'ap-south-1c',
            cidrBlock: '10.0.4.0/24', // 256
            tags: [{ key: "Name", value: "Primary/VPC/Subnet/PrivateResource-3" }]
        })
        new CfnOutput(this, 'PrivateResourceSubnet3Id', {
            value: privateResourceSubnet3.attrSubnetId,
            exportName: 'PrivateResourceSubnet3Id',
            description: 'The ID of Primary Private Workload Subnet-3'
        })

        // Public Sub NACL Associate
        new ec2.CfnSubnetNetworkAclAssociation(this, 'PublicSub1NaclAssociate', {
            networkAclId: primaryCentralNacl.attrId,
            subnetId: publicSubnet1.attrSubnetId
        })
        new ec2.CfnSubnetNetworkAclAssociation(this, 'PublicSub2NaclAssociate', {
            networkAclId: primaryCentralNacl.attrId,
            subnetId: publicSubnet2.attrSubnetId
        })
        new ec2.CfnSubnetNetworkAclAssociation(this, 'PublicSub3NaclAssociate', {
            networkAclId: primaryCentralNacl.attrId,
            subnetId: publicSubnet3.attrSubnetId
        })

        // Private Resource Sub NACL Associate
        new ec2.CfnSubnetNetworkAclAssociation(this, 'PrivateResourceSub1NaclAssociate', {
            networkAclId: primaryCentralNacl.attrId,
            subnetId: privateResourceSubnet1.attrSubnetId
        })
        new ec2.CfnSubnetNetworkAclAssociation(this, 'PrivateResourceSub2NaclAssociate', {
            networkAclId: primaryCentralNacl.attrId,
            subnetId: privateResourceSubnet2.attrSubnetId
        })
        new ec2.CfnSubnetNetworkAclAssociation(this, 'PrivateResourceSub3NaclAssociate', {
            networkAclId: primaryCentralNacl.attrId,
            subnetId: privateResourceSubnet3.attrSubnetId
        })

        // Public Subnet Route Table Associate
        new ec2.CfnSubnetRouteTableAssociation(this, 'PublicSub1Route1Associate', {
            subnetId: publicSubnet1.attrSubnetId,
            routeTableId: primaryPublicRouteTable1.attrRouteTableId
        })
        new ec2.CfnSubnetRouteTableAssociation(this, 'PublicSub2Route2Associate', {
            subnetId: publicSubnet2.attrSubnetId,
            routeTableId: primaryPublicRouteTable2.attrRouteTableId
        })
        new ec2.CfnSubnetRouteTableAssociation(this, 'PublicSub2Route3Associate', {
            subnetId: publicSubnet3.attrSubnetId,
            routeTableId: primaryPublicRouteTable3.attrRouteTableId
        })

        // Private Resource Subnet Route Table Associate
        new ec2.CfnSubnetRouteTableAssociation(this, 'PrivateResourceSub1Route1Associate', {
            subnetId: privateResourceSubnet1.attrSubnetId,
            routeTableId: primaryPrivateRouteTable1.attrRouteTableId
        })
        new ec2.CfnSubnetRouteTableAssociation(this, 'PrivateResourceSub2Route2Associate', {
            subnetId: privateResourceSubnet2.attrSubnetId,
            routeTableId: primaryPrivateRouteTable2.attrRouteTableId
        })
        new ec2.CfnSubnetRouteTableAssociation(this, 'PrivateResourceSub3Route3Associate', {
            subnetId: privateResourceSubnet3.attrSubnetId,
            routeTableId: primaryPrivateRouteTable3.attrRouteTableId
        })

        // Internet Gateway configuration
        const primaryInternetGateway = new ec2.CfnInternetGateway(this, 'PrimaryInternetGateway', {
            tags: [{ key: 'Name', value: 'Primary/VPC/IGW' }]
        })

        new ec2.CfnVPCGatewayAttachment(this, 'AttachIGWToVpc', {
            vpcId: primaryVpc.attrVpcId,
            internetGatewayId: primaryInternetGateway.attrInternetGatewayId
        })

        // Internet gateway route for Public Subnets
        new ec2.CfnRoute(this, 'PublicRoute1Entry-1', {
            routeTableId: primaryPublicRouteTable1.attrRouteTableId,
            destinationCidrBlock: '0.0.0.0/0',
            gatewayId: primaryInternetGateway.attrInternetGatewayId
        })
        new ec2.CfnRoute(this, 'PublicRoute2Entry-1', {
            routeTableId: primaryPublicRouteTable2.attrRouteTableId,
            destinationCidrBlock: '0.0.0.0/0',
            gatewayId: primaryInternetGateway.attrInternetGatewayId
        })
        new ec2.CfnRoute(this, 'PublicRoute3Entry-1', {
            routeTableId: primaryPublicRouteTable3.attrRouteTableId,
            destinationCidrBlock: '0.0.0.0/0',
            gatewayId: primaryInternetGateway.attrInternetGatewayId
        })


        // Private Workload Instance and Service Security group
        const primaryPrivateWorkloadSG = new ec2.CfnSecurityGroup(this, 'PrimaryPrivateWorkloadSG', {
            groupName: 'Primary/VPC/SG/Private-Workload',
            groupDescription: 'Security Group for Private ECS Instances and Services',
            vpcId: primaryVpc.attrVpcId,
            tags: [{ key: 'Name', value: 'Primary/VPC/SG/Private-Workload' }]
        })

        new CfnOutput(this, 'PrimaryPrivateWorkloadSGId', {
            value: primaryPrivateWorkloadSG.attrGroupId,
            exportName: 'PrimaryPrivateWorkloadSGId',
            description: 'The ID of Primary Private Workload Security Group'
        })

        // External Alb SG
        const primaryExternalAlbSG = new ec2.CfnSecurityGroup(this, 'PrimaryExternalAlbSG', {
            groupName: 'Primary/VPC/SG/External-ALB',
            groupDescription: 'Security Group for Internet facing Application Load Balancer',
            vpcId: primaryVpc.attrVpcId,
            tags: [{ key: 'Name', value: 'Primary/VPC/SG/External-ALB' }]
        })

        new CfnOutput(this, 'PrimaryExternalAlbSGId', {
            value: primaryExternalAlbSG.attrGroupId,
            exportName: 'PrimaryExternalAlbSGId',
            description: 'The ID of Primary External Alb Security Group'
        })

        // Internal Alb SG
        const primaryInternalAlbSG = new ec2.CfnSecurityGroup(this, 'PrimaryInternalAlbSG', {
            groupName: 'Primary/VPC/SG/Internal-ALB',
            groupDescription: 'Security Group for Internal Application Load Balancer',
            vpcId: primaryVpc.attrVpcId,
            tags: [{ key: 'Name', value: 'Primary/VPC/SG/Internal-ALB' }]
        })

        new CfnOutput(this, 'PrimaryInternalAlbSGId', {
            value: primaryInternalAlbSG.attrGroupId,
            exportName: 'PrimaryInternalAlbSGId',
            description: 'The ID of Primary Internal Alb Security Group'
        })

        // VPC Link SG
        const primaryVpcLinkSG = new ec2.CfnSecurityGroup(this, 'PrimaryVpcLinkSG', {
            groupName: 'Primary/VPC/SG/Vpc-Link',
            groupDescription: 'Security Group for Vpc Link',
            vpcId: primaryVpc.attrVpcId,
            tags: [{ key: 'Name', value: 'Primary/VPC/SG/Vpc-Link' }]
        })


        // Private Workload SG Inbound Rules
        new ec2.CfnSecurityGroupIngress(this, 'PrivateWorkloadSgInbound-1', {
            groupId: primaryPrivateWorkloadSG.attrGroupId,
            ipProtocol: 'tcp',
            sourceSecurityGroupId: primaryExternalAlbSG.attrGroupId,
            description: 'Allow incominng traffic from External ALB to Private ECS Instance and Workload',
            fromPort: 0,
            toPort: 65535
        })

        new ec2.CfnSecurityGroupIngress(this, 'PrivateWorkloadSgInbound-2', {
            groupId: primaryPrivateWorkloadSG.attrGroupId,
            ipProtocol: 'tcp',
            sourceSecurityGroupId: primaryInternalAlbSG.attrGroupId,
            description: 'Allow incominng traffic from Internal ALB to Private ECS Instance and Workload',
            fromPort: 0,
            toPort: 65535
        })

        // Private Workload SG Outbound Rules
        new ec2.CfnSecurityGroupEgress(this, 'PrivateWorkloadSgOutbound-1', {
            groupId: primaryPrivateWorkloadSG.attrGroupId,
            ipProtocol: 'tcp',
            destinationSecurityGroupId: primaryInternalAlbSG.attrGroupId,
            description: 'Allow outgoing HTTP traffic from Private ECS Instance and Service to Internal ALB',
            fromPort: 80,
            toPort: 80
        })

        // External ALB Inbound Rules 
        new ec2.CfnSecurityGroupIngress(this, 'ExternalAlbSgInbound-1', {
            groupId: primaryExternalAlbSG.attrGroupId,
            ipProtocol: 'tcp',
            description: 'Allow Internet access for IPV4 over HTTPS',
            fromPort: 443,
            toPort: 443,
            cidrIp: '0.0.0.0/0'
        })

        // External ALB Outbound Rules 
        new ec2.CfnSecurityGroupEgress(this, 'ExternalAlbSgOutbound-1', {
            groupId: primaryExternalAlbSG.attrGroupId,
            ipProtocol: 'tcp',
            cidrIp: '0.0.0.0/0',
            description: 'Allow outgoing Private traffic from Extrenal ALB to Private Instance',
            fromPort: 443,
            toPort: 443
        })
        new ec2.CfnSecurityGroupEgress(this, 'ExternalAlbSgOutbound-2', {
            groupId: primaryExternalAlbSG.attrGroupId,
            ipProtocol: 'tcp',
            destinationSecurityGroupId: primaryPrivateWorkloadSG.attrGroupId,
            description: 'Allow outgoing Private traffic from Extrenal ALB to Private Instance',
            fromPort: 0,
            toPort: 65535
        })

        // Internal ALB Security Group Inbound Rules
        new ec2.CfnSecurityGroupIngress(this, 'InternalAlbSgInbound-1', {
            groupId: primaryInternalAlbSG.attrGroupId,
            ipProtocol: 'tcp',
            cidrIp: primaryVpc.cidrBlock,
            description: 'Allow incoming main traffic from Network',
            fromPort: 80,
            toPort: 80,
        })

        // Internal ALB Security Group Outbound Rules
        new ec2.CfnSecurityGroupEgress(this, 'InternalAlbSgOutbound-1', {
            groupId: primaryInternalAlbSG.attrGroupId,
            ipProtocol: 'tcp',
            destinationSecurityGroupId: primaryPrivateWorkloadSG.attrGroupId,
            description: 'Allow outgoing Private traffic from Internal ALB to Private Instance and Workload',
            fromPort: 0,
            toPort: 65535,
        })

        // S3 Gateway Endpoint
        new ec2.CfnVPCEndpoint(this, 'S3GatewayEndpoint}', {
            serviceName: `com.amazonaws.ap-south-1.region.s3`,
            vpcId: primaryVpc.attrVpcId,
            vpcEndpointType: 'Gateway',
            routeTableIds: [
                primaryPrivateRouteTable1.attrRouteTableId, primaryPrivateRouteTable2.attrRouteTableId, primaryPrivateRouteTable3.attrRouteTableId
            ]
        })

        // S3 lifecycle configuration
        let s3Lifecycle = {
            rules: [
                {
                    status: 'Enabled',
                    expirationInDays: 30,
                    id: 'delete-object-90-days'
                }
            ]
        }

        // <------------------------ Internet facing ALB Configurations ------------------------>
        const primaryExternalAlbAccessLogBucket = new s3.CfnBucket(this, 'PrimaryExternalAlbAccessLogS3', {
            bucketName: `webapp-alb-access-logs`,
            lifecycleConfiguration: s3Lifecycle
        })

        new s3.CfnBucketPolicy(this, 'PrimaryExternalAlbAccessLogBucketPolicy', {
            bucket: primaryExternalAlbAccessLogBucket.bucketName,
            policyDocument: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {
                            "AWS": `arn:aws:iam::718504428378:root`
                        },
                        "Action": "s3:PutObject",
                        "Resource": `${primaryExternalAlbAccessLogBucket.attrArn}/AWSLogs/${Stack.of(this).account}/*`
                    },
                    {
                        "Effect": "Allow",
                        "Principal": {
                            "Service": "delivery.logs.amazonaws.com"
                        },
                        "Action": "s3:PutObject",
                        "Resource": `${primaryExternalAlbAccessLogBucket.attrArn}/AWSLogs/${Stack.of(this).account}/*`,
                        "Condition": {
                            "StringEquals": {
                                "s3:x-amz-acl": "bucket-owner-full-control"
                            }
                        }
                    },
                    {
                        "Effect": "Allow",
                        "Principal": {
                            "Service": "delivery.logs.amazonaws.com"
                        },
                        "Action": "s3:GetBucketAcl",
                        "Resource": `${primaryExternalAlbAccessLogBucket.attrArn}`
                    }
                ]
            }
        })

        // External ALB
        const primaryExternalAlb = new elbv2.CfnLoadBalancer(this, 'PrimaryExternalAlb', {
            ipAddressType: 'ipv4',
            loadBalancerAttributes: [
                { key: 'deletion_protection.enabled', value: 'true' },
                { key: 'access_logs.s3.enabled', value: 'true' },
                { key: 'access_logs.s3.bucket', value: primaryExternalAlbAccessLogBucket.bucketName }
            ],
            name: 'primary-external-alb',
            scheme: 'internet-facing',
            securityGroups: [primaryExternalAlbSG.attrGroupId],
            subnets: [publicSubnet1.attrSubnetId, publicSubnet2.attrSubnetId, publicSubnet3.attrSubnetId],
            type: 'application'
        })

        new CfnOutput(this, 'PrimaryExternalAlbDns', {
            value: primaryExternalAlb.attrDnsName,
            exportName: 'PrimaryExternalAlbDns',
            description: 'The DNS name for PrimaryExternalAlb'
        })
        new CfnOutput(this, 'PrimaryExternalAlbArn', {
            value: primaryExternalAlb.attrLoadBalancerArn,
            exportName: 'PrimaryExternalAlbArn',
            description: 'The Arn for PrimaryExternalAlb'
        })

        const primaryExternalAlbMainListener = new elbv2.CfnListener(this, 'PrimaryExternalAlbMainListener', {
            defaultActions: [
                {
                    type: 'fixed-response',
                    fixedResponseConfig: {
                        statusCode: '400',
                        contentType: 'text/plain',
                        messageBody: 'Bad Request'
                    }
                }],
            loadBalancerArn: primaryExternalAlb.attrLoadBalancerArn,
            port: 443,
            protocol: 'HTTPS',
            sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
            certificates: appDefaultCertificateArn
        })

        new CfnOutput(this, 'PrimaryExternalAlbMainListenerArn', {
            value: primaryExternalAlbMainListener.attrListenerArn,
            exportName: 'PrimaryExternalAlbMainListenerArn',
            description: 'The Arn for Primary External Alb Main Listener'
        })

        // Internal ALB Configurations
        const primaryInternalAlbAccessLogBucket = new s3.CfnBucket(this, 'PrimaryInternalAlbAccessLogBucket', {
            bucketName: 'internal-alb-access-logs',
            lifecycleConfiguration: s3Lifecycle
        })

        new s3.CfnBucketPolicy(this, 'PrimaryInternalAlbAccessLogBucketPolicy', {
            bucket: primaryInternalAlbAccessLogBucket.bucketName,
            policyDocument: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {
                            "AWS": `arn:aws:iam::718504428378:root`
                        },
                        "Action": "s3:PutObject",
                        "Resource": `${primaryInternalAlbAccessLogBucket.attrArn}/AWSLogs/${Stack.of(this).account}/*`
                    },
                    {
                        "Effect": "Allow",
                        "Principal": {
                            "Service": "delivery.logs.amazonaws.com"
                        },
                        "Action": "s3:PutObject",
                        "Resource": `${primaryInternalAlbAccessLogBucket.attrArn}/AWSLogs/${Stack.of(this).account}/*`,
                        "Condition": {
                            "StringEquals": {
                                "s3:x-amz-acl": "bucket-owner-full-control"
                            }
                        }
                    },
                    {
                        "Effect": "Allow",
                        "Principal": {
                            "Service": "delivery.logs.amazonaws.com"
                        },
                        "Action": "s3:GetBucketAcl",
                        "Resource": `${primaryInternalAlbAccessLogBucket.attrArn}`
                    }
                ]
            }
        })

        // Internal ALB
        const primaryInternalAlb = new elbv2.CfnLoadBalancer(this, 'PrimaryInternalAlb', {
            ipAddressType: 'ipv4',
            loadBalancerAttributes: [
                { key: 'deletion_protection.enabled', value: 'true' },
                { key: 'access_logs.s3.enabled', value: 'true' },
                { key: 'access_logs.s3.bucket', value: primaryInternalAlbAccessLogBucket.bucketName },
                { key: 'idle_timeout.timeout_seconds', value: '900' }
            ],
            name: 'primary-internal-alb',
            scheme: 'internal',
            securityGroups: [primaryInternalAlbSG.attrGroupId],
            subnets: [privateResourceSubnet1.attrSubnetId, privateResourceSubnet2.attrSubnetId, privateResourceSubnet3.attrSubnetId],
            type: 'application'
        })

        new CfnOutput(this, 'PrimaryInternalAlbDnsName', {
            exportName: "PrimaryInternalAlbDnsName",
            description: 'The DNS name of Primary Internal ALB',
            value: primaryInternalAlb.attrDnsName
        })
        new CfnOutput(this, 'PrimaryInternalAlbArn', {
            exportName: "PrimaryInternalAlbArn",
            description: 'The ARN of Primary Internal ALB',
            value: primaryInternalAlb.attrLoadBalancerArn
        })

        const primaryInternalAlbListener = new elbv2.CfnListener(this, 'PrimaryInternalAlbListener', {
            loadBalancerArn: primaryInternalAlb.attrLoadBalancerArn,
            port: 80,
            protocol: 'HTTP',
            defaultActions: [
                {
                    type: 'fixed-response',
                    fixedResponseConfig: {
                        statusCode: '400',
                        contentType: 'text/plain',
                        messageBody: 'Bad Request'
                    }
                }
            ]
        })

        new CfnOutput(this, 'PrimaryInternalAlbListenerArn', {
            exportName: "PrimaryInternalAlbListenerArn",
            description: 'The ARN of  Primary Internal Alb Listener',
            value: primaryInternalAlbListener.attrListenerArn
        })

        // <------------------------ API Gateway Configurations ------------------------>

        let allowOrigins = ['http://localhost:8888', 'http://localhost:3333', 'http://localhost:4444']

        const primaryHttpApi = new apigw_v2.CfnApi(this, 'PrimaryHttpApi', {
            corsConfiguration: {
                allowCredentials: true,
                allowHeaders: ['Authorization', 'content-type', 'x-amz-content-sha256', 'x-amz-date'],
                allowMethods: ['OPTIONS', 'POST', 'GET', 'PUT', 'DELETE'],
                allowOrigins,
                exposeHeaders: ['flat-file-sequence-number'],
                maxAge: Duration.days(1).toSeconds(),
            },
            name: 'PrimaryHttpApi',
            protocolType: 'HTTP'
        })

        new CfnOutput(this, 'PrimaryHttpApiId', {
            value: primaryHttpApi.ref,
            description: 'The Primary HTTP API Id',
            exportName: 'primaryHttpApiId',
        });

        const primaryHttpApiLogs = new logs.CfnLogGroup(this, 'PrimaryHttpApiAccessLogs', {
            logGroupName: 'Primary/APIGW/HTTP/AccessLog',
            retentionInDays: 7
        })

        const primaryHttpApiStage = new apigw_v2.CfnStage(this, 'PrimaryHttpApiStage', {
            apiId: primaryHttpApi.ref,
            stageName: 'prod',
            autoDeploy: true,
            accessLogSettings: {
                destinationArn: primaryHttpApiLogs.attrArn,
                format: JSON.stringify({
                    requestId: "$context.requestId",
                    path: "$context.path",
                    httpMethod: "$context.httpMethod",
                    status: "$context.status",
                    ip: "$context.identity.sourceIp",
                    cognitoStatus: "$context.authorizer.status",
                    cognitoError: "$context.authorizer.error",
                    cognitoLatency: "$context.authorizer.latency",
                    integrationStatus: "$context.integration.status",
                    integrationLatency: "$context.integration.latency",
                    user: "$context.authorizer.claims.username",
                    requestTime: "$context.requestTime"
                })
            }
        })
        const primaryHttpApiDomainName = new apigw_v2.CfnDomainName(this, 'PrimaryHttpApiDomainName', {
            domainName: 'api.demo.in',
            domainNameConfigurations: [{
                certificateArn: httpApiDomainCertArn,
                endpointType: 'REGIONAL',
                securityPolicy: 'TLS_1_2',
                certificateName: 'PrimaryHttpApiCertificate'
            }]
        })

        const primaryHttpApiMapping = new apigw_v2.CfnApiMapping(this, 'PrimaryHttpApiMapping', {
            apiId: primaryHttpApi.ref,
            stage: primaryHttpApiStage.stageName,
            domainName: primaryHttpApiDomainName.domainName,
        })

        primaryHttpApiMapping.addDependency(primaryHttpApiDomainName);
        primaryHttpApiMapping.addDependency(primaryHttpApiStage);

        const primaryHttpApiNewCognitoAuthorizer = new apigw_v2.CfnAuthorizer(this, 'PrimaryHttpApiCognitoAuthorizer-1', {
            name: 'PrimaryHttpApiCognitoAuthorizer-1',
            apiId: primaryHttpApi.ref,
            authorizerType: 'JWT',
            identitySource: ['$request.header.Authorization'],
            jwtConfiguration: {
                audience: [cognitoUserPoolClientId],
                issuer: `https://cognito-idp.ap-south-1.amazonaws.com/${cognitoUserPoolId}`
            }
        });
        new CfnOutput(this, 'PrimaryHttpApiCognitoAuthorizerId', {
            value: primaryHttpApiNewCognitoAuthorizer.ref,
            description: 'The Primary HTTP API Authorizer Id',
            exportName: 'PrimaryHttpApiCognitoAuthorizerId',
        });


        const primaryVpcLink = new apigw_v2.CfnVpcLink(this, 'PrimaryVpcLink', {
            name: "PrimaryVpcLink",
            subnetIds: [privateResourceSubnet1.attrSubnetId, privateResourceSubnet2.attrSubnetId, privateResourceSubnet3.attrSubnetId],
            securityGroupIds: [primaryVpcLinkSG.attrId]
        })
        new CfnOutput(this, 'PrimaryVpcLinkId', {
            value: primaryVpcLink.ref,
            description: 'The Id of the VPC Link',
            exportName: 'PrimaryVpcLinkId',
        });

    }
}

module.exports = { NetworkInfraStack }
