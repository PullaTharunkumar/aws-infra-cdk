const { Stack, CfnOutput } = require('aws-cdk-lib');
const sns = require('aws-cdk-lib/aws-sns')
const sns_subscriptions = require('aws-cdk-lib/aws-sns-subscriptions')

class SnsNotificationStack extends Stack {
    /**
     *
     * @param {Construct} scope
     * @param {string} id
     * @param {StackProps=} props
     */
    constructor(scope, id, props) {
        super(scope, id, props);

        const {
            topicName,
            email
        } = props

        const notificationTopic = new sns.Topic(this, 'NotificationTopic', {
            topicName
        })
        
        notificationTopic.addSubscription(new sns_subscriptions.EmailSubscription(email))


        new CfnOutput(this, 'NotificationTopicArn', {
            exportName: 'NotificationTopicArn',
            description: 'ARN of metrics-notification SNS Topic',
            value: notificationTopic.topicArn
        })

    }
}

module.exports = { SnsNotificationStack }