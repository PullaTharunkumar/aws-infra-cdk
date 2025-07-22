const { Stack, Duration, RemovalPolicy, Tags } = require('aws-cdk-lib');
const codepipeline = require('aws-cdk-lib/aws-codepipeline');
const codebuild = require('aws-cdk-lib/aws-codebuild')
const logs = require('aws-cdk-lib/aws-logs')
const iam = require('aws-cdk-lib/aws-iam')
const codepipeline_actions = require('aws-cdk-lib/aws-codepipeline-actions')
const s3 = require('aws-cdk-lib/aws-s3')
const sns = require('aws-cdk-lib/aws-sns')
const ecs = require('aws-cdk-lib/aws-ecs')
const codestarnotifications = require('aws-cdk-lib/aws-codestarnotifications')

class PipelineStack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    const {
      kmsKeyArn,
      pipelineArtifactBucketArn,
      environmentVariables,
      gitBranch,
      codeStarConnectionArn,
      pipelineSnsArn,
      ecsClusterName,
      encFilePath,
      repo,
      containerName,
      ecsServiceName
    } = props





    const pipelineArtifactBucket = s3.Bucket.fromBucketArn(this, 'PipelineBucket', `${pipelineArtifactBucketArn}`)

    const pipelineAccessPolicy = new iam.ManagedPolicy(this, `PipelineAccessPolicy`, {
      managedPolicyName: `PipelineAccessPolice`,
      document: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "s3:GetBucket*",
              "s3:GetObject*",
              "s3:List*",
              "s3:PutObject",
              "s3:PutObjectLegalHold",
              "s3:PutObjectRetention",
              "s3:PutObjectTagging",
              "s3:PutObjectVersionTagging"
            ],
            resources: [
              `pipelineArtifactBucketArn`,
              `${pipelineArtifactBucketArn}/*`
            ]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["sts:AssumeRole"],
            resources: "*",
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "ecs:DescribeServices",
              "ecs:DescribeTaskDefinition",
              "ecs:DescribeTasks",
              "ecs:ListTasks",
              "ecs:RegisterTaskDefinition",
              "ecs:TagResource",
              "ecs:UpdateService"
            ],
            resources: "*"
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "iam:PassRole"
            ],
            resources: "*",
            conditions: {
              "StringEqualsIfExists" : {
                "iam:PassedToService": [
                  "ec2.amazonaws.com",
                  "ecs-tasks.amazonaws.com"
                ]
              }
            }
          })
        ]
      })
    })

    //CodePipeline service role
    const codePipelineRole = new iam.Role(this, 'CodePipelineRole', {
      roleName: `CodePipelineRole`,
      description: 'Policy used in trust relationship with CodePipeline',
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com')
    });

    codePipelineRole.addManagedPolicy(pipelineAccessPolicy);

    //Policy needed for event bridge trigger 
    codePipelineRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchEventsFullAccess"));


    //Codebuild service role            
    const buildProjectRole = new iam.Role(this, 'CodeBuildRole', {
      roleName: `CodeBuildRole`,
      description: 'Policy used in trust relationship with CodeBuild',
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com')
    });

    //Policy needed for building docker images and pushing the image to ECR
    buildProjectRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryPowerUser"))

    //KMS inline policy for codebuild for decrypting ENV
    buildProjectRole.attachInlinePolicy(
      new iam.Policy(this, 'codebuild-kms-decrypt', {
        policyName: `codebuild-kms-decrypt`,
        description: 'Policy for codebuild to give kms decrypt access',
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['kms:Decrypt'],
            resources: [kmsKeyArn]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ssm:GetParameters'],
            resources: ['*']
          })
        ]
      })
    )

    // Pipelines
      const constructName = repo.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('')
      //Source Artifact
      const sourceArtifact = new codepipeline.Artifact(`${constructName}SourceArtifact`);

      //Source Stage
      const sourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction({
        actionName: 'Github',
        owner: 'Demo',
        repo: repo,
        branch: gitBranch,
        output: sourceArtifact,
        connectionArn: codeStarConnectionArn,
        variablesNamespace: 'SourceVariables',
        triggerOnPush: false,
      })

      //Build Artifact
      const buildArtifact = new codepipeline.Artifact(`${constructName}BuildArtifact`);

      // Log Group
      const logGroup = new logs.LogGroup(this, `${constructName}BuildLogGroup`, {
        logGroupName: `${constructName}/CodeBuild/LogGroup`,
        retention: logs.RetentionDays.THREE_DAYS,
        removalPolicy: RemovalPolicy.DESTROY
      })

      // Build Project
      const buildProject = new codebuild.PipelineProject(this, `${constructName}BuildProject`, {
        projectName: `${repo}-build-project`,
        timeout: Duration.minutes(60),
        environment: {
          computeType: codebuild.ComputeType.LARGE,
          buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
          privileged: true
        },
        environmentVariables,
        logging: {
          cloudWatch: {
            logGroup
          }
        },
        role: buildProjectRole,
        buildSpec: codebuild.BuildSpec.fromObject({
          version: 0.2,
          env: {
            'parameter-store': {
              GITHUB_TOKEN: "/github/token"
            }
          },
          phases: {
            install: {
              commands: ['npm install -g yarn']
            },
            pre_build: {
              commands: [
                `aws kms decrypt --ciphertext-blob fileb://$(pwd)${encFilePath} --key-id $KMS_KEY_ID --output text --query Plaintext | base64 --decode >  .env`,
                `echo Environment Variables decrypted... `,
                `echo Logging in to Amazom ECR...`,
                `aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com`,
                `current_version=$(aws ecr describe-images --repository-name ${repo} --query 'sort_by(imageDetails[?imageTags != 'null'], &imagePushedAt)[-1].imageTags[0]' --output text)`,
                'numeric_version="${current_version##*.}"',
                `next_numeric_version=$((numeric_version + 1))`,
                'IMAGE_TAG="${current_version%.*}.$next_numeric_version"',
                `echo $IMAGE_TAG`,
                              
              ]
            },
            build: {
              commands: [
                `echo Building the Docker image...`,
                `docker build --build-arg CICD_USER_PAT=$GITHUB_TOKEN --build-arg NODE_VERSION=$NODE_VERSION -t ${repo}:$IMAGE_TAG .`,
                `docker tag ${repo}:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/${repo}:$IMAGE_TAG`
              ]
            },
            post_build: {
              commands: [
                `echo Build completed on $(date)`,
                `echo Pushing the Docker image to ECR...`,
                `docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/${repo}:$IMAGE_TAG`,
                `echo Docker image successfully pushed to ECR...`,
                `printf '[{"name":"${containerName}","imageUri":"%s"}]' $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/${repo}:$IMAGE_TAG > imagedefinitions.json`
              ]
            }
          },
          artifacts: {
            files: 'imagedefinitions.json'
          }
        })
      })

      // Build Stage
      const dockerBuildAction = new codepipeline_actions.CodeBuildAction({
        actionName: 'Docker-Build',
        project: buildProject,
        input: sourceArtifact,
        outputs: [buildArtifact]
      })


      // ECS Service
      const service = ecs.Ec2Service.fromEc2ServiceAttributes(this, `${constructName}EcsService`, {
        serviceName: ecsServiceName,
        cluster: {
          clusterName: ecsClusterName
        }
      })


      // Deploy Stage
      const deployAction = new codepipeline_actions.EcsDeployAction({
        actionName: 'Deploy',
        input: buildArtifact,
        deploymentTimeout: Duration.minutes(60),
        service,
        role: codePipelineRole
      })

      // CodePipeline
      const pipeline = new codepipeline.Pipeline(this, `${constructName}Pipeline`, {
        pipelineName: repo,
        crossAccountKeys: false,
        role: codePipelineRole,
        artifactBucket: pipelineArtifactBucket,
        pipelineType: "V2"
      })

      // Manual approval
      const approval = new codepipeline_actions.ManualApprovalAction({
        actionName: `${repo}-approval`
      })

      /************************************* Notification Setup ****************************************/
      // SNS Topic for Pipeline
      const topic = sns.Topic.fromTopicArn(this, `${constructName}PipelineSnsTopic`, `${pipelineSnsArn}`)

      // Notification rule 
      const notificationRule = new codestarnotifications.NotificationRule(this, `${constructName}NotificationRule`, {
        source: pipeline,
        events: [
          'codepipeline-pipeline-action-execution-failed',
          'codepipeline-pipeline-stage-execution-failed',
          'codepipeline-pipeline-pipeline-execution-failed'
        ],
        notificationRuleName: `${repo}-pipeline-notification-rule`,
        enabled: true,
        detailType: codestarnotifications.DetailType.FULL,
        targets: [topic]
      })

      /**********************Adding diffrent stage to pipeline************************/
      pipeline.addStage({
        stageName: 'Source',
        actions: [sourceAction]
      })

      // Build Stage
      pipeline.addStage({
        stageName: 'Docker-Build',
        actions: [dockerBuildAction]
      })

      //  Check and Approve stage
      pipeline.addStage({
        stageName: 'Approval',
        actions: [approval]
      })

      // Deploy stage
      pipeline.addStage({
        stageName: 'Deploy',
        actions: [deployAction]
      })
    
  }
}

module.exports = { PipelineStack }
