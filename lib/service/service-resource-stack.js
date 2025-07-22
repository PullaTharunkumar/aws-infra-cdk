const { Stack, CfnOutput } = require('aws-cdk-lib'); // Import necessary classes from the AWS CDK library
const ecr = require('aws-cdk-lib/aws-ecr'); // Import the AWS CDK module for Amazon ECR

class DemoServiceResourceStack extends Stack {
    /**
     * Constructor for the stack
     *
     * @param {Construct} scope 
     * @param {string} id 
     * @param {StackProps=} props
     */
    constructor(scope, id, props) {
        super(scope, id, props);

       
        const {
            imageCount,
            ecrRepoName
        } = props;

        let ecrLifeCycleRule = {
            "rules": [
                {
                    "rulePriority": 1,
                    "description": `This rule is used to retain only the latest ${imageCount} docker images`,
                    "selection": {
                        "tagStatus": "any",
                        "countType": "imageCountMoreThan",
                        "countNumber": imageCount
                    },
                    "action": {
                        "type": "expire"
                    }
                }
            ]
        }
        new ecr.CfnRepository(this, 'DemoServiceEcrRepo', {
            imageScanningConfiguration: {
                scanOnPush: true
            },
            imageTagMutability: 'IMMUTABLE',
            repositoryName: ecrRepoName,
            ...(imageCount ? ({ lifecyclePolicy: { lifecyclePolicyText: JSON.stringify(ecrLifeCycleRule) } }) : {})
        })


    }
}

module.exports = { DemoServiceResourceStack }