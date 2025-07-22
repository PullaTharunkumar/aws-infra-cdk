const { Stack, RemovalPolicy } = require('aws-cdk-lib');
const logs = require('aws-cdk-lib/aws-logs')
const wafv2 = require('aws-cdk-lib/aws-wafv2')

class SecurityStack extends Stack {
    /**
     *
     * @param {Construct} scope
     * @param {string} id
     * @param {StackProps=} props
     */
    constructor(scope, id, props) {
        super(scope, id, props);

        const {
            primaryExternalAlbArns,
            logRetention,
        } = props

        // const ipSet = new wafv2.CfnIPSet(this, 'WhiteListIpSet', {
        //     name: 'WhiteListIpSet',
        //     ipAddressVersion: 'IPV4',
        //     scope: 'ap-south-1',
        //     addresses: ['']
        // })

        // WAF Configuration
        const primaryWebAcl = new wafv2.CfnWebACL(this, 'PrimaryWebAcl', {
            defaultAction: {
                allow: {}
            },
            visibilityConfig: {
                metricName: 'PrimaryWebAclMetric',
                cloudWatchMetricsEnabled: true,
                sampledRequestsEnabled: true

            },
            scope: 'REGIONAL',
            name: 'PrimaryWebAcl',
            rules: [
                {
                    name: 'BlockUnwantedGeolocation',
                    priority: 0,
                    statement: {
                        notStatement: {
                            statement: {
                                geoMatchStatement: {
                                    countryCodes: ['IN']
                                }
                            }
                        }
                    },
                    action: {
                        block: {}
                    },
                    visibilityConfig: {
                        metricName: 'PrimaryWebAclGeolocationMetric',
                        cloudWatchMetricsEnabled: true,
                        sampledRequestsEnabled: true
                    }
                },
                {
                    name: 'AWS-AWSManagedRulesLinuxRuleSet',
                    priority: 1,
                    statement: {
                        managedRuleGroupStatement: {
                            name: 'AWSManagedRulesLinuxRuleSet',
                            vendorName: 'AWS'
                        }
                    },
                    visibilityConfig: {
                        metricName: 'LinuxRuleSetMetric',
                        cloudWatchMetricsEnabled: true,
                        sampledRequestsEnabled: true
                    },
                    overrideAction: {
                        none: {}
                    }
                },
                {
                    name: 'AWS-AWSManagedRulesUnixRuleSet',
                    priority: 2,
                    statement: {
                        managedRuleGroupStatement: {
                            name: 'AWSManagedRulesUnixRuleSet',
                            vendorName: 'AWS'
                        }
                    },
                    visibilityConfig: {
                        metricName: 'UnixRuleSetMetric',
                        cloudWatchMetricsEnabled: true,
                        sampledRequestsEnabled: true
                    },
                    overrideAction: {
                        none: {}
                    }
                },
                {
                    name: 'BlockEnvUri',
                    priority: 4,
                    statement: {
                        byteMatchStatement: {
                            searchString: '/.env',
                            fieldToMatch: {
                                uriPath: {}
                            },
                            positionalConstraint: 'CONTAINS',
                            textTransformations: [{
                                priority: 0,
                                type: 'NONE'
                            }]
                        }
                    },
                    action: {
                        block: {}
                    },
                    visibilityConfig: {
                        metricName: 'BlockEnvUriMetric',
                        cloudWatchMetricsEnabled: true,
                        sampledRequestsEnabled: true
                    }
                },
                // {
                //     name: 'IpWhiteList',
                //     priority: 5,
                //     statement: {
                //         ipSetReferenceStatement: {
                //             arn: ipSet.attrArn
                //         }
                //     },
                //     action: {
                //         allow: {}
                //     },
                //     visibilityConfig: {
                //         metricName: 'PrimaryWebAclGeolocationMetric',
                //         cloudWatchMetricsEnabled: true,
                //         sampledRequestsEnabled: true
                //     }
                // }
            ]
        })

        new wafv2.CfnWebACLAssociation(this, `AssociatePrimaryExternalAlb`, {
            webAclArn: primaryWebAcl.attrArn,
            resourceArn: primaryExternalAlbArns
        })

        const webAclLogs = new logs.LogGroup(this, 'PrimaryWebAclLogs', {
            logGroupName: `aws-waf-logs-primary-web-Acl-logs`,
            retention: logRetention,
            removalPolicy: RemovalPolicy.DESTROY
        })

        new wafv2.CfnLoggingConfiguration(this, 'PrimaryWebAclLogsConfiguration', {
            resourceArn: primaryWebAcl.attrArn,
            logDestinationConfigs: [
                webAclLogs.logGroupArn
            ],
            loggingFilter: {
                DefaultBehavior: 'DROP',
                Filters: [
                    {
                        Behavior: 'KEEP',
                        Conditions: [
                            {
                                ActionCondition: {
                                    Action: 'BLOCK',
                                },
                            }
                        ],
                        Requirement: 'MEETS_ALL',
                    }
                ]
            }
        })
    }
}

module.exports = { SecurityStack }
