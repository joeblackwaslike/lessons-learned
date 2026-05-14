I need to deploy Elasticsearch 8.x to our production Kubernetes cluster. I've decided on this approach:

1. Install the Elasticsearch Helm chart with a 3-node cluster configuration
2. Configure persistent volumes using our existing StorageClass
3. Set up node affinity rules to spread pods across availability zones
4. Enable TLS using cert-manager for inter-node and client communication

Walk me through implementing this plan step by step.
