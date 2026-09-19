import { memorySetup } from './memoryCampaignSource'
import { runApprovalContract, runCampaignSourceContract } from './contract'

runCampaignSourceContract('in-memory reference adapter', memorySetup)
runApprovalContract('in-memory reference adapter', memorySetup)
