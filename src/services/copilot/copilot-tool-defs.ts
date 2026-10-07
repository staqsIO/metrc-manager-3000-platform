// Pure data: Copilot tool definitions (OpenAI-compatible function schemas)
// Separated from copilot-tools.ts so client components can import without
// pulling in server-side dependencies (node:crypto via @metrc-formul8-os/client).

import type { ToolDefinition } from './openrouter-client';
import { ACTIONS_ENABLED } from '../../shared/constants/feature-flags';

// ---------------------------------------------------------------------------
// Tool Definitions (OpenAI-compatible function schemas)
// ---------------------------------------------------------------------------

export const COPILOT_ACTION_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'flag_packages_for_discount',
      description: 'Flag one or more packages with a discount note for aging inventory. Changes the package note in Metrc. Max 50 packages per call.',
      parameters: {
        type: 'object',
        properties: {
          labels: { type: 'array', items: { type: 'string' }, description: 'Full package labels (e.g., AAAFF0B00000B69000000077). Do NOT use truncated labels.' },
        },
        required: ['labels'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flag_packages_for_testing',
      description: 'ACTION: Submit packages for lab testing via POST /packages/v2/testing. Creates lab sample packages and transitions source packages to SubmittedForTesting state. Falls back to adding a note if the API call fails (e.g., CO packages that are already eligible). Use search_packages or get_lab_test_results first to find which packages need testing. Max 50 packages per call.',
      parameters: {
        type: 'object',
        properties: {
          labels: { type: 'array', items: { type: 'string' }, description: 'Full package labels (e.g., AAAFF0B00000B69000000077). Do NOT use truncated labels.' },
        },
        required: ['labels'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remediate_packages_action',
      description: 'Flag packages for remediation in Metrc. Use when packages have failed lab testing or need remediation. Max 50 packages per call.',
      parameters: {
        type: 'object',
        properties: {
          labels: { type: 'array', items: { type: 'string' }, description: 'Full package labels (e.g., AAAFF0B00000B69000000077). Do NOT use truncated labels.' },
        },
        required: ['labels'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish_packages_action',
      description: 'Finish/destroy packages and remove them from active inventory. WARNING: This is IRREVERSIBLE. You MUST first call this with confirmed=false to get a preview, then call again with confirmed=true only after the user explicitly confirms.',
      parameters: {
        type: 'object',
        properties: {
          labels: { type: 'array', items: { type: 'string' }, description: 'Full package labels (e.g., AAAFF0B00000B69000000077). Do NOT use truncated labels.' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after the user has explicitly confirmed destruction. First call should be false to preview.' },
        },
        required: ['labels', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'adjust_package_quantity',
      description: 'Adjust the quantity of a single package (e.g., for sampling out a portion). Changes the quantity in Metrc.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Full package label (e.g., AAAFF0B00000B69000000077). Do NOT use truncated labels.' },
          new_quantity: { type: 'number', description: 'New quantity after adjustment' },
          reason: { type: 'string', description: 'Reason for the adjustment' },
        },
        required: ['label', 'new_quantity', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish_harvests_action',
      description: 'Finish/close one or more active harvests. WARNING: This marks harvests as complete and is IRREVERSIBLE. You MUST first call with confirmed=false to preview, then confirmed=true after user confirms. Max 50 per call.',
      parameters: {
        type: 'object',
        properties: {
          harvest_ids: { type: 'array', items: { type: 'number' }, description: 'Harvest IDs to finish' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user has explicitly confirmed. First call should be false.' },
        },
        required: ['harvest_ids', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_packages_from_harvest',
      description: 'Create new packages from an active harvest. Converts harvest weight into packaged inventory. You MUST first call with confirmed=false to preview, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          harvest_id: { type: 'number', description: 'Harvest ID to create packages from' },
          item_name: { type: 'string', description: 'Item/product name for the new packages' },
          quantity: { type: 'number', description: 'Weight/quantity per package' },
          unit: { type: 'string', description: 'Unit of measure (e.g., Grams, Ounces)' },
          package_count: { type: 'number', description: 'Number of packages to create (default: 1)' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['harvest_id', 'item_name', 'quantity', 'unit', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_harvest_waste',
      description: 'Record waste/trim from an active harvest. Logs the waste weight and type in Metrc.',
      parameters: {
        type: 'object',
        properties: {
          harvest_id: { type: 'number', description: 'Harvest ID to record waste for' },
          waste_type: { type: 'string', description: 'Type of waste. Valid values: Plant Material, Roots, Stalks, Trim Waste, Other' },
          waste_weight: { type: 'number', description: 'Weight of waste in grams' },
          unit: { type: 'string', description: 'Unit of measure (default: Grams)' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['harvest_id', 'waste_type', 'waste_weight', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'destroy_plant_batches_action',
      description: 'Destroy one or more plant batches. WARNING: This is IRREVERSIBLE. You MUST first call with confirmed=false to preview, then confirmed=true after user confirms. Max 50 per call.',
      parameters: {
        type: 'object',
        properties: {
          plant_batch_ids: { type: 'array', items: { type: 'number' }, description: 'Plant batch IDs to destroy' },
          reason: { type: 'string', description: 'Reason for destruction' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['plant_batch_ids', 'reason', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_plant_batches_action',
      description: 'Create new plant batches (seed or clone starts). Use strain NAME (not ID). If location is unknown, use get_locations to find available locations first. You MUST first call with confirmed=false to preview, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Batch name' },
          type: { type: 'string', description: 'Batch type: Seed or Clone' },
          strain: { type: 'string', description: 'Strain name' },
          count: { type: 'number', description: 'Number of plants' },
          location: { type: 'string', description: 'Location/room name' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['name', 'type', 'strain', 'count', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_supply_receipt',
      description: 'Record receiving non-Metrc supply stock (e.g., packaging materials, labels, solvents). Searches for the supply item by name and increments its stock level. You MUST first call with confirmed=false to preview, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          item_name: { type: 'string', description: 'Search term to find the supply item by name' },
          quantity: { type: 'number', description: 'Quantity received' },
          notes: { type: 'string', description: 'Optional notes about the receipt' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['item_name', 'quantity', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_strain_action',
      description: 'Create a new cannabis strain in Metrc. You MUST first call with confirmed=false to preview, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Strain name (e.g., "Durban Poison")' },
          indica_percentage: { type: 'number', description: 'Indica percentage (0-100)' },
          sativa_percentage: { type: 'number', description: 'Sativa percentage (0-100)' },
          thc_level: { type: 'number', description: 'THC level (0-100)' },
          cbd_level: { type: 'number', description: 'CBD level (0-100)' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['name', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_item_action',
      description: 'Create a new product item in Metrc. You MUST first call with confirmed=false to preview, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Item name (e.g., "Blue Dream Flower 1oz")' },
          item_category: { type: 'string', description: 'Metrc item category (e.g., "Buds", "Concentrate", "Infused Edible")' },
          unit_of_measure: { type: 'string', description: 'Unit of measure (e.g., "Ounces", "Grams", "Each")' },
          strain: { type: 'string', description: 'Optional strain name to associate' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['name', 'item_category', 'unit_of_measure', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_location_action',
      description: 'Create a new room/location in Metrc. You MUST first call with confirmed=false to preview, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Location name (e.g., "Drying Room A")' },
          location_type_name: { type: 'string', description: 'Location type (e.g., "Default Location Type")' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['name', 'location_type_name', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_plant_growth_phase_action',
      description: 'Move plant batches to a new growth phase (e.g., Vegetative → Flowering). You MUST first call with confirmed=false to preview, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          plant_batch_name: { type: 'string', description: 'Name of the plant batch to transition' },
          count: { type: 'number', description: 'Number of plants to move to the new phase' },
          new_growth_phase: { type: 'string', description: 'Target growth phase: "Vegetative" or "Flowering"' },
          new_location: { type: 'string', description: 'New location/room for the plants' },
          starting_tag: { type: 'string', description: 'Starting RFID tag (required when moving clones to Vegetative)' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['plant_batch_name', 'count', 'new_growth_phase', 'new_location', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_incoming_transfer_action',
      description: 'Create an external incoming transfer manifest (packages being shipped TO this facility from another). You MUST first call with confirmed=false to preview, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          shipper_license: { type: 'string', description: 'Shipper facility license number (who is sending TO this facility)' },
          package_labels: { type: 'array', items: { type: 'string' }, description: 'Full package labels being received' },
          transfer_type: { type: 'string', description: 'Transfer type (default: "Affiliated Transfer")' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['shipper_license', 'package_labels', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_lab_test_action',
      description: 'Record lab test results for a package in Metrc. You MUST first call with confirmed=false to preview, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          package_label: { type: 'string', description: 'Full package label to record test for' },
          test_type_name: { type: 'string', description: 'Test type (e.g., "THC", "Pesticides", "Microbials")' },
          overall_passed: { type: 'boolean', description: 'Whether the test passed overall' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                test_type_name: { type: 'string', description: 'Individual test name' },
                value: { type: 'number', description: 'Test result value' },
                passed: { type: 'boolean', description: 'Whether this individual test passed' },
              },
            },
            description: 'Array of individual test results',
          },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['package_label', 'test_type_name', 'overall_passed', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_processing_package_action',
      description: 'Create a new package from source packages (processing/manufacturing). Converts input packages into a new output package. You MUST first call with confirmed=false to preview, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'RFID tag for the new package' },
          item: { type: 'string', description: 'Item/product name for the new package' },
          quantity: { type: 'number', description: 'Quantity of the new package' },
          unit_of_measure: { type: 'string', description: 'Unit of measure (e.g., "Grams", "Each")' },
          source_packages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Source package label' },
                quantity: { type: 'number', description: 'Quantity to use from source' },
                unit_of_measure: { type: 'string', description: 'Unit of source quantity' },
              },
            },
            description: 'Source packages and quantities to consume',
          },
          note: { type: 'string', description: 'Optional processing note' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['tag', 'item', 'quantity', 'unit_of_measure', 'source_packages', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_disposition',
      description: 'Record a non-sale inventory disposition (sample-out, vendor day, promo, damage, waste). Adjusts package quantity and logs the event for compliance tracking. You MUST first call with confirmed=false to preview, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          package_label: { type: 'string', description: 'Full package label (e.g., AAAFF0B00000B69000000077). Do NOT use truncated labels.' },
          category: { type: 'string', enum: ['sample', 'vendor_day', 'promo', 'damage', 'waste'], description: 'Disposition category' },
          quantity: { type: 'number', description: 'Quantity being disposed (e.g., grams, units)' },
          unit_of_measure: { type: 'string', description: 'Unit of measure (e.g., Grams, Each, Ounces)' },
          estimated_value: { type: 'number', description: 'Estimated dollar value of disposed product' },
          recipient_name: { type: 'string', description: 'Name of recipient (for samples, vendor days, promos)' },
          note: { type: 'string', description: 'Note explaining the disposition' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms. First call should be false.' },
        },
        required: ['package_label', 'category', 'quantity', 'unit_of_measure', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_business_rule',
      description: 'Create a new business rule for automated compliance alerts. Translates natural language rule descriptions into structured conditions. You MUST first call with confirmed=false to preview the rule, then confirmed=true after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short descriptive name for the rule (e.g., "Aging Warning 120+ days")' },
          description: { type: 'string', description: 'Human-readable description of what this rule does' },
          category: { type: 'string', enum: ['aging', 'inventory', 'compliance', 'operations', 'discount'], description: 'Rule category' },
          severity: { type: 'string', enum: ['INFO', 'WARNING', 'CRITICAL'], description: 'Alert severity level' },
          action_type: {
            type: 'string',
            enum: ['ALERT', 'NOTIFICATION', 'BLOCK', 'DISCOUNT_RECOMMEND', 'AUTO_DISCOUNT', 'PROMO_FLAG', 'CONSOLIDATE', 'SAMPLE_OUT'],
            description: 'Action to take when rule triggers',
          },
          conditions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: {
                  type: 'string',
                  enum: ['ageDays', 'Quantity', 'ItemCategory', 'ItemName', 'ItemStrainName', 'LabTestingState', 'IsOnHold', 'IsTestingSample', 'IsTradesSample', 'ProductRequiresRemediation', 'LocationName', 'PackageType', 'PackagedDate', 'UnitOfMeasureName', 'ageCategory'],
                  description: 'Package field to evaluate',
                },
                operator: {
                  type: 'string',
                  enum: ['gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'contains', 'not_contains', 'in', 'not_in'],
                  description: 'Comparison operator',
                },
                value: { description: 'Value to compare against (number, string, boolean, or array of strings)' },
                item_category: { type: 'string', description: 'Optional: only apply this condition to packages of this Metrc item category (e.g., "Flower", "Concentrate")' },
              },
              required: ['field', 'operator', 'value'],
            },
            description: 'Conditions that must ALL be true for the rule to trigger (AND logic)',
          },
          state_code: { type: 'string', description: 'Optional 2-letter state code (e.g., "CO", "MA") to make this a state-specific rule' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms the preview. First call should be false.' },
        },
        required: ['name', 'category', 'severity', 'action_type', 'conditions', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_plant_batch_waste',
      description: 'Record waste for a plant batch. First call with confirmed=false to preview, then call again with confirmed=true to execute.',
      parameters: {
        type: 'object',
        properties: {
          plant_batch_id: { type: 'number', description: 'Plant batch ID' },
          plant_batch_name: { type: 'string', description: 'Plant batch name' },
          waste_reason_name: { type: 'string', description: 'Waste reason (e.g., Contamination, Mold/Mildew, Pest Damage, Male Plants, Other)' },
          waste_weight: { type: 'number', description: 'Weight of waste' },
          unit_of_weight: { type: 'string', description: 'Unit of weight (default: Grams)' },
          actual_date: { type: 'string', description: 'Date of waste event (YYYY-MM-DD)' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms the preview. First call should be false.' },
        },
        required: ['plant_batch_id', 'plant_batch_name', 'waste_reason_name', 'waste_weight', 'actual_date', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'destroy_plants_action',
      description: 'Destroy mature plants with a specified waste method and reason. First call with confirmed=false to preview, then call again with confirmed=true to execute.',
      parameters: {
        type: 'object',
        properties: {
          plant_ids: { type: 'array', items: { type: 'number' }, description: 'Array of plant IDs to destroy' },
          waste_method_name: { type: 'string', description: 'Waste method (e.g., Grinder, Compost, Incinerator)' },
          reason_note: { type: 'string', description: 'Reason for destroying plants' },
          actual_date: { type: 'string', description: 'Date of destruction (YYYY-MM-DD)' },
          confirmed: { type: 'boolean', description: 'Set to true ONLY after user confirms the preview. First call should be false.' },
        },
        required: ['plant_ids', 'waste_method_name', 'reason_note', 'actual_date', 'confirmed'],
      },
    },
  },
];

export const COPILOT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_inventory_overview',
      description: 'Get a summary of current inventory including total packages, categories, quantities, and key metrics.',
      parameters: { type: 'object', properties: {}, required: [] },
      truncationBudget: 12_000,
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_aging',
      description: 'Analyze inventory aging distribution. Shows how many packages fall into fresh (0-30d), normal (31-60d), aging (61-90d), and critical (90+d) buckets with quantities and package details.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_aging_recommendations',
      description: 'Get specific recommendations for aging inventory including which products to discount, sample out, destroy, remediate, or expedite for testing — prioritized by urgency. Use this when operators ask "what products need discounts?", "what should I do with aging inventory?", or "which packages are aging and need attention?".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detect_fifo_violations',
      description: 'Detect FIFO (First In First Out) violations where newer packages are being used before older ones within the same category and strain.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detect_slow_moving',
      description: 'Find slow-moving, stagnant, and dead inventory packages that haven\'t moved in 45+, 75+, or 120+ days. Use this to identify products that need discounts, promotions, or clearance. Answers questions like "what products are sitting idle?", "which inventory needs markdowns?", or "what products are aging and need discounts?".',
      parameters: {
        type: 'object',
        properties: {
          slow_days: { type: 'number', description: 'Days threshold for slow-moving (default: 45)' },
          stagnant_days: { type: 'number', description: 'Days threshold for stagnant (default: 75)' },
          dead_days: { type: 'number', description: 'Days threshold for dead stock (default: 120)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_compliance_audit',
      description: 'Run a comprehensive compliance audit scoring the facility across 5 categories: Lab Testing, Inventory Aging, Package Holds, Location Tracking, and Data Completeness. Returns an overall score 0-100 and specific findings.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'evaluate_business_rules',
      description: 'Evaluate all active business rules against current inventory to find violations. Covers aging thresholds, low quantity, on-hold status, lab testing gaps, and more.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detect_fragmentation',
      description: 'Find fragmented inventory - items that are split across many small packages and could be consolidated for efficiency.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_consolidation_recommendations',
      description: 'Get specific recommendations for consolidating fragmented packages to reduce package count and improve efficiency.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_sample_out_candidates',
      description: 'Find packages suitable for sampling out as trade samples or promotional samples based on low quantity and age.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detect_short_counts',
      description: 'Find packages where current quantity does not match standard case size multiples. Infers case size from the mode (most common quantity) per item. Flags potential inventory discrepancies that may indicate receiving or counting errors.',
      parameters: {
        type: 'object',
        properties: {
          mode_threshold: {
            type: 'number',
            description: 'Minimum frequency for the mode to be trusted (default: 3). Higher values require more evidence before flagging.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_biomass',
      description: 'Analyze biomass and waste inventory (trim, shake, plant waste) for recovery opportunities and utilization suggestions.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assess_fulfillment_risk',
      description: 'Assess fulfillment risk by analyzing stock levels per category, hold rates, expiring inventory, and transfer velocity.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_employee_patterns',
      description: 'Analyze employee activity patterns from transfer data including activity levels, after-hours work, and package handling volumes.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'identify_training_needs',
      description: 'Identify employee training needs by analyzing error rates, low volumes, after-hours activity, and hold associations.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_tolling',
      description: 'Calculate tolling economics given input weight, output weight, and processing fee per unit.',
      parameters: {
        type: 'object',
        properties: {
          input_weight: { type: 'number', description: 'Input weight in grams' },
          output_weight: { type: 'number', description: 'Output weight in grams' },
          processing_fee: { type: 'number', description: 'Processing fee per gram of input' },
        },
        required: ['input_weight', 'output_weight', 'processing_fee'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_packages',
      description: 'Search for specific packages by keyword across ALL fields (label, item name, category, strain, location). IMPORTANT: When a user asks about a specific product type (e.g., "distillate bulk", "live rosin", "gummies"), ALWAYS pass their search terms in the `query` parameter — do NOT decompose into category/strain filters. The query performs full-text multi-word matching that is much more accurate than guessing category names. Use category/strain filters only when the user explicitly requests an exact category or strain.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'PREFERRED: Free-text search. Multi-word queries match packages where ALL words appear across label, item name, category, strain, and location. Use this for product searches like "distillate bulk", "live rosin", "pre roll". More accurate than category filters.' },
          category: { type: 'string', description: 'Filter by exact item category. Only use when user explicitly names a Metrc category, NOT for product keyword searches.' },
          strain: { type: 'string', description: 'Filter by strain name' },
          on_hold: { type: 'boolean', description: 'Filter to only on-hold packages' },
          lab_testing_state: { type: 'string', description: 'Filter by lab testing state: NotSubmitted, SubmittedForTesting, TestPassed, TestFailed' },
          min_age_days: { type: 'number', description: 'Minimum age in days' },
          max_age_days: { type: 'number', description: 'Maximum age in days' },
          limit: { type: 'number', description: 'Max results (default: 20, max: 50). Use higher limits for comprehensive searches.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_harvest_summary',
      description: 'Get a summary of all harvests including active, on-hold, and finished counts, total weights, strain breakdown, and drying location distribution.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_harvests',
      description: 'List all active harvests with details including name, strain, current weight, waste, packages created, and age.',
      parameters: {
        type: 'object',
        properties: {
          strain: { type: 'string', description: 'Filter by strain name' },
          limit: { type: 'number', description: 'Max results to return (default: 25)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_plant_batch_summary',
      description: 'Get a summary of all plant batches including active/inactive counts, total plant counts by type (seed vs clone), strain breakdown, and tracking status.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_plant_batches',
      description: 'List active plant batches with details including name, type, strain, plant counts, and location.',
      parameters: {
        type: 'object',
        properties: {
          strain: { type: 'string', description: 'Filter by strain name' },
          type: { type: 'string', description: 'Filter by batch type: Seed or Clone' },
          limit: { type: 'number', description: 'Max results to return (default: 25)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_plants',
      description: 'List individual active plants with label, strain, growth phase, location, and age. Filterable by strain or growth phase.',
      parameters: {
        type: 'object',
        properties: {
          strain: { type: 'string', description: 'Filter by strain name' },
          growth_phase: { type: 'string', description: 'Filter by growth phase: Vegetative, Flowering, etc.' },
          limit: { type: 'number', description: 'Max results to return (default: 25)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transfer_summary',
      description: 'Get a summary of incoming and outgoing transfers including counts, pending vs received, package totals, and recent transfers in each direction.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_lab_test_results',
      description: 'Get lab test results including pass/fail counts, breakdown by test type, and individual result details. Also shows packages that have NOT been submitted for testing yet (NotSubmitted state). Use this to find packages that need lab testing or to check overall testing compliance.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results to return (default: 25)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_strains',
      description: 'Get the strain catalog with THC/CBD levels and indica/sativa percentages for all active strains.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_items',
      description: 'Get the product catalog with category, unit of measure, and strain. Filterable by product category.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter by product category name' },
          limit: { type: 'number', description: 'Max results to return (default: 50)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_opex_models',
      description: 'List all OpEx models for the current facility with their KPI summaries (revenue, cost, margin, profit). Shows draft, active, and archived models.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_opex_model_detail',
      description: 'Get detailed values for a specific OpEx model including all cell values organized by section. Use this to answer questions about specific cost line items, yields, labor costs, etc.',
      parameters: {
        type: 'object',
        properties: {
          model_id: { type: 'string', description: 'The OpEx model ID' },
        },
        required: ['model_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'simulate_opex_change',
      description: 'Simulate what-if changes to an OpEx model WITHOUT saving. Changes one or more input values and returns the recalculated KPIs and affected cells. Great for answering "what if yield increases by 10%?" type questions.',
      parameters: {
        type: 'object',
        properties: {
          model_id: { type: 'string', description: 'The OpEx model ID to simulate against' },
          changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                cell_key: { type: 'string', description: 'Cell key to change (e.g., "core.yield_lbs", "core.price_per_lb", "labor.trim_hourly_rate")' },
                new_value: { type: 'number', description: 'New value to simulate' },
              },
              required: ['cell_key', 'new_value'],
            },
            description: 'Array of cell changes to simulate',
          },
        },
        required: ['model_id', 'changes'],
      },
    },
  },
  // -----------------------------------------------------------------------
  // SUPPLY INVENTORY TOOLS
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'query_supply_inventory',
      description: 'Query non-Metrc supply inventory items (packaging materials, labels, solvents, etc.) with optional search and category filters. Returns items with current stock levels.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Search term to match against item name' },
          category: { type: 'string', description: 'Filter by supply category' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_production_feasibility',
      description: 'Check if you have enough non-Metrc supply materials (packaging, labels, etc.) to produce a given quantity of a Metrc item. Uses Bill of Materials (BOM) to find the constraining component.',
      parameters: {
        type: 'object',
        properties: {
          metrc_item_name: { type: 'string', description: 'The Metrc item/product name to check feasibility for' },
          requested_quantity: { type: 'number', description: 'How many units you want to produce' },
        },
        required: ['metrc_item_name', 'requested_quantity'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_low_stock_alerts',
      description: 'Get all non-Metrc supply items that are below their reorder point. Useful for proactive restocking before production runs.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // -----------------------------------------------------------------------
  // PACKAGE PROVENANCE TOOL
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_package_provenance',
      description: 'Trace the full lineage of a package — its ancestors (source packages and harvests) and descendants (child packages created from it). Builds a provenance tree showing the complete chain of custody.',
      parameters: {
        type: 'object',
        properties: {
          package_label: { type: 'string', description: 'The Metrc package label to trace provenance for' },
        },
        required: ['package_label'],
      },
    },
  },
  // -----------------------------------------------------------------------
  // SEED-TO-SALE JOURNEY TOOLS
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'trace_package_journey',
      description: 'Trace the full seed-to-sale journey of a package: provenance tree (ancestors + descendants), transfer links (incoming/outgoing manifests), and Dutchie POS sales matches. Use this for "where did this package come from and where did it go?" questions.',
      parameters: {
        type: 'object',
        properties: {
          package_label: { type: 'string', description: 'The Metrc package label to trace the full journey for' },
        },
        required: ['package_label'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reconcile_package_sales',
      description: 'Check if a specific package has been sold via Dutchie POS. Returns matching sales transactions with product name, quantity, total price, and sale date.',
      parameters: {
        type: 'object',
        properties: {
          package_label: { type: 'string', description: 'The Metrc package label to check for sales' },
        },
        required: ['package_label'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transfer_chain',
      description: 'For a package, show its transfer history: where it came from (incoming manifest with shipper facility) and where it went (outgoing transfer heuristic with receiver facility).',
      parameters: {
        type: 'object',
        properties: {
          package_label: { type: 'string', description: 'The Metrc package label to get transfer history for' },
        },
        required: ['package_label'],
      },
    },
  },
  // -----------------------------------------------------------------------
  // ADVANCED TOLLING TOOLS
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'calculate_advanced_tolling',
      description: 'Calculate tolling economics with a multi-fee structure. Supports per-gram-input, per-gram-output, flat, and percentage-of-revenue fee types with optional min/max caps.',
      parameters: {
        type: 'object',
        properties: {
          input_weight_grams: { type: 'number', description: 'Input weight in grams sent to the processor' },
          output_weight_grams: { type: 'number', description: 'Expected output weight in grams after processing' },
          fees: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Fee label (e.g., "Processing Fee", "Lab Testing")' },
                type: { type: 'string', description: 'Fee type: per_gram_input, per_gram_output, flat, or percentage_revenue' },
                amount: { type: 'number', description: 'Fee rate/amount' },
              },
              required: ['name', 'type', 'amount'],
            },
            description: 'Array of fee definitions',
          },
          revenue_per_gram: { type: 'number', description: 'Revenue per gram of output (needed for percentage_revenue fees)' },
        },
        required: ['input_weight_grams', 'output_weight_grams', 'fees'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_tolling_partners',
      description: 'Compare tolling economics across multiple processing partners. Ranks partners by cost-per-gram-output and shows full fee breakdowns for each.',
      parameters: {
        type: 'object',
        properties: {
          input_weight_grams: { type: 'number', description: 'Input weight in grams' },
          output_weight_grams: { type: 'number', description: 'Expected output weight in grams' },
          revenue_per_gram: { type: 'number', description: 'Revenue per gram of output' },
          scenarios: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                partner_name: { type: 'string', description: 'Processing partner name' },
                fees: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Fee label' },
                      type: { type: 'string', description: 'Fee type: per_gram_input, per_gram_output, flat, or percentage_revenue' },
                      amount: { type: 'number', description: 'Fee rate/amount' },
                    },
                    required: ['name', 'type', 'amount'],
                  },
                  description: 'Fee definitions for this partner',
                },
              },
              required: ['partner_name', 'fees'],
            },
            description: 'Array of partner scenarios to compare',
          },
        },
        required: ['input_weight_grams', 'output_weight_grams', 'revenue_per_gram', 'scenarios'],
      },
    },
  },
  // -----------------------------------------------------------------------
  // SALES TOOLS (Dutchie)
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_sales_summary',
      description: 'Get a summary of sales data from the POS system (Dutchie) including total revenue, average order value, transaction count, top category, tax, and discounts.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_products',
      description: 'Get the top-selling products ranked by revenue with unit counts, categories, and brands.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results to return (default: 10)' },
        },
        required: [],
      },
    },
  },
  // -----------------------------------------------------------------------
  // INVENTORY RUN-RATE ANALYSIS TOOL
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'analyze_inventory_run_rate',
      description: 'Analyze inventory run rates by comparing current Metrc package quantities against Dutchie POS sales velocity. Shows weeks-of-supply per category and SKU, identifies promo candidates (excess stock) and manufacturing priorities (low stock). Use this for questions like "how many weeks of pre-rolls do we have?" or "which categories can handle a promo?"',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter to a specific product category' },
          days_lookback: { type: 'number', description: 'Days of sales history to calculate velocity (default: 30)' },
          limit: { type: 'number', description: 'Max results per section (default: 20)' },
        },
        required: [],
      },
    },
  },
  // -----------------------------------------------------------------------
  // FINANCIAL REPORTING TOOL (Org-level)
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_org_financials',
      description: 'Get consolidated financial data across all facilities in the organization. Includes revenue, cost, gross margin, gross profit, tolling fees, and supply costs per facility and as org totals.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // -----------------------------------------------------------------------
  // TAG INVENTORY TOOLS
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_tag_inventory',
      description: 'Get Metrc tag inventory status: available/used counts, usage percentage, next 5 available tag labels, and low-stock warning.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_tags',
      description: 'Search Metrc tags by label substring. Returns matching tags with their status (Available or Used).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Label substring to search for (e.g., "000042" or "1A4FF")' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recommend_biomass_usage',
      description: 'Get AI-powered processing recommendations for raw materials and biomass inventory. Analyzes strain yield history, processing ratios from past jobs, and compliance status to recommend optimal processing paths (extraction, pre-rolls, wholesale, etc.) with urgency levels and yield estimates. Use when operators ask "what should I do with my biomass?", "best use for my trim/shake/fresh frozen?", or "how should I process my raw materials?".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assess_testing_risk',
      description: 'Assess lab testing risk for packages awaiting testing. Analyzes historical pass/fail rates by strain and test type to identify which packages are most likely to fail. Use when operators ask "which packages are at risk of failing lab tests?", "what strains have poor test history?", or "should I be worried about upcoming lab results?".',
      parameters: {
        type: 'object',
        properties: {
          strain: { type: 'string', description: 'Filter results to a specific strain name' },
          risk_level: { type: 'string', description: 'Filter to a specific risk level: critical, high, medium, low' },
          limit: { type: 'number', description: 'Max at-risk packages to return (default: 25)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_potency_trends',
      description: 'Analyze potency trending and consistency for strains or products. Shows THC/CBD/terpene result levels over time, flags drift when recent potency moves >2\u03c3 from the historical baseline, detects outliers, and ranks strains by consistency (coefficient of variation). Use when operators ask "how consistent is Blue Dream potency?", "is our THC trending up or down?", "which strains have the most stable lab results?", "are there any potency outliers?", or "compare potency across batches".',
      parameters: {
        type: 'object',
        properties: {
          strain: { type: 'string', description: 'Filter to a specific strain name' },
          test_type: { type: 'string', description: 'Filter to specific test type (e.g., Potency, Terpenes). Default: all types.' },
          group_by: { type: 'string', enum: ['strain', 'item'], description: 'Group results by normalized strain name (default) or by exact item/product name' },
          limit: { type: 'number', description: 'Max trend groups to return (default: 15)' },
        },
        required: [],
      },
    },
  },
  // -----------------------------------------------------------------------
  // CROSS-FACILITY STRAIN COMPARISON
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'compare_strains',
      description: 'Compare strain performance (yield, lab pass rate, growth duration) across multiple facilities. Returns metrics per strain per facility with significant differences highlighted. Requires the user to have visited the Strain Analysis page recently for data to be cached.',
      parameters: {
        type: 'object',
        properties: {
          strainNames: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional filter: specific strain names to compare. If omitted, compares all strains.',
          },
        },
        required: [],
      },
    },
  },
  // -----------------------------------------------------------------------
  // AUTO-DISCOUNT ENGINE TOOLS
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_auto_discount_dashboard_stats',
      description: 'Get auto-discount engine KPIs for this facility — whether it is enabled, how many active discounts, total revenue impact, and recent run history. Use when operators ask "how are my auto-discounts performing?" or "is auto-discount turned on?".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_auto_discounts',
      description: 'Preview what the auto-discount engine would recommend for this facility without executing anything. Shows which packages would be discounted and by how much based on aging, velocity, and category rules. Use when operators ask "what discounts would the engine apply?" or "show me the discount plan".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // -----------------------------------------------------------------------
  // CONSOLIDATED FINANCIAL TOOLS
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_consolidated_pnl',
      description: 'Get a consolidated Profit & Loss statement across all accessible facilities in the organization. Includes revenue, cost, gross margin, gross profit broken down per facility and aggregated. Optionally group by state or facility type. Use for questions like "what is our total revenue?" or "show me P&L by state".',
      parameters: {
        type: 'object',
        properties: {
          group_by: { type: 'string', enum: ['state', 'facilityType'], description: 'Optional grouping: "state" or "facilityType"' },
        },
        required: [],
      },
      truncationBudget: 12_000,
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_category_margins',
      description: 'Get per-category sales breakdown from POS data (last N days). Shows revenue, units sold, and average price per unit for each product category. Use for "which categories sell the most?" or "what is my best-selling category?".',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Days of sales history to analyze (default: 30, max: 90)' },
        },
        required: [],
      },
      truncationBudget: 12_000,
    },
  },
  // -----------------------------------------------------------------------
  // TOLLING RECONCILIATION
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_tolling_reconciliation',
      description: 'Get financial reconciliation for a specific tolling agreement. Shows material flow (input weight to output weight), fee breakdown by type, yield guarantee variance, cost-per-gram metrics, and per-batch details. Use when operators ask "reconcile my tolling agreement" or "how much do I owe the processor?".',
      parameters: {
        type: 'object',
        properties: {
          agreement_id: { type: 'string', description: 'The tolling agreement ID to reconcile' },
        },
        required: ['agreement_id'],
      },
    },
  },
  // -----------------------------------------------------------------------
  // CROSS-FACILITY OPERATIONS TOOLS
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_operations_summary',
      description: 'Get an executive-level operations summary across all accessible facilities. Aggregates harvest intake, throughput, waste rate, and active harvest counts across the organization. Use for "give me the big picture" or "executive summary".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_run_rate_comparison',
      description: 'Compare inventory run-rates (weeks of supply) across multiple facilities by category. Shows which facilities have excess or deficit inventory relative to their sales velocity. Use for "which facility has the most pre-rolls?" or "where should we transfer inventory?".',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter to a specific product category' },
        },
        required: [],
      },
      truncationBudget: 12_000,
    },
  },
  // -----------------------------------------------------------------------
  // CANIX ERP / COGS TOOLS
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_package_cogs',
      description: 'Compute per-package Cost of Goods Sold using the COGS waterfall: Canix BOM cost rollup > Canix standard cost > Dutchie unitCost > Manual OpEx > none. Returns per-package COGS with source attribution, confidence scores, and summary statistics. Use for "what does this product cost?", "show me COGS", or "margin analysis".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_procurement_status',
      description: 'Get open purchase order status from Canix ERP. Shows in-transit and pending POs with expected delivery dates, vendor names, and line item details. Use for "what POs are outstanding?", "when is the next delivery?", or "procurement pipeline status".',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['draft', 'submitted', 'confirmed', 'in_transit', 'received', 'cancelled'], description: 'Filter by PO status (optional, defaults to open POs)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_bom_comparison',
      description: 'Compare Canix authoritative Bills of Materials against BOMs inferred from processing history. Flags deviations as info (<10%), warning (10-25%), or critical (>25%). Use for "are our recipes accurate?", "BOM validation", or "compare actual vs expected yields".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // -----------------------------------------------------------------------
  // CROSS-FACILITY INVENTORY SUMMARY
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_cross_facility_inventory_summary',
      description: 'Get total inventory weight/quantity aggregated across all accessible facilities, broken down by category. Shows per-facility breakdown and org-level totals. Use for "how much total weight across all facilities?" or "what is our total inventory?".',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter to a specific product category (optional)' },
        },
        required: [],
      },
    },
  },
  // -----------------------------------------------------------------------
  // AUDIT READINESS
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_audit_readiness_report',
      description: 'Get a comprehensive audit readiness report with detailed scoring across categories, employee analysis, open findings with remediation guidance, action log summary, and reconciliation statistics. More detailed than the basic compliance audit. Use for "am I ready for an audit?" or "what is my full audit readiness score?".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // -----------------------------------------------------------------------
  // DAILY SALES (POS)
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_daily_sales',
      description: 'Get daily sales breakdown from POS for the last N days. Shows revenue, order count, average order value, and top category per day. Use for "how were sales this week?" or "show me daily revenue trend".',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to look back (default: 30, max: 90)' },
        },
        required: [],
      },
      truncationBudget: 12_000,
    },
  },
  // -----------------------------------------------------------------------
  // TOLLING BREAKEVEN ANALYSIS
  // -----------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'find_tolling_breakeven',
      description: 'Find the breakeven yield percentage where two tolling partners become equally costly. Useful for contract negotiation — if yield is above breakeven, one partner is cheaper; below breakeven, the other is cheaper.',
      parameters: {
        type: 'object',
        properties: {
          input_weight_grams: { type: 'number', description: 'Input weight in grams being sent for processing' },
          revenue_per_gram: { type: 'number', description: 'Expected revenue per gram of output' },
          partner_a: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Partner A name' },
              fees: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Fee label' },
                    type: { type: 'string', description: 'Fee type: per_gram_input, per_gram_output, flat, or percentage_revenue' },
                    amount: { type: 'number', description: 'Fee rate/amount' },
                  },
                  required: ['name', 'type', 'amount'],
                },
                description: 'Fee definitions for Partner A',
              },
            },
            required: ['name', 'fees'],
            description: 'First tolling partner with fee structure',
          },
          partner_b: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Partner B name' },
              fees: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Fee label' },
                    type: { type: 'string', description: 'Fee type: per_gram_input, per_gram_output, flat, or percentage_revenue' },
                    amount: { type: 'number', description: 'Fee rate/amount' },
                  },
                  required: ['name', 'type', 'amount'],
                },
                description: 'Fee definitions for Partner B',
              },
            },
            required: ['name', 'fees'],
            description: 'Second tolling partner with fee structure',
          },
        },
        required: ['input_weight_grams', 'revenue_per_gram', 'partner_a', 'partner_b'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_disposition_summary',
      description: 'Get monthly disposition tracking summary with budget utilization by category (sample, vendor day, promo, damage, waste). Shows units and value consumed vs configured limits, remaining budget, and alert status.',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'Month in YYYY-MM format (defaults to current month)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pipeline_summary',
      description: 'Get farm-to-cash pipeline overview showing product flow by stage (harvested, post-harvest, testing, processed, retail-ready, in-transit, sold). Returns stage-by-stage package counts, weights, average age, harvest intake stats, and conversion rate (% of harvest weight that reached retail/sold).',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_harvest_cash_tracker',
      description: 'Trace all active and recently finished harvests through the pipeline to cash. For each harvest, shows: strain, weight, % at each stage, % sold, revenue realized, average days to sale. Sorted by % sold ascending (least converted first).',
      parameters: {
        type: 'object',
        properties: {
          harvest_name: { type: 'string', description: 'Optional: trace a specific harvest by name. If omitted, traces all harvests.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_waste_analysis',
      description: 'Get comprehensive waste/loss analysis across all sources (harvest waste, plant batch waste, package adjustments, plant destruction). Returns total waste weight, waste rate %, breakdown by source type, time-series trends, top reasons, and period-over-period comparison.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to analyze (default: 90)' },
          granularity: { type: 'string', enum: ['day', 'week', 'month'], description: 'Trend granularity (default: week)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reconcile_audit_trail',
      description: 'Cross-reference Canix ERP audit trail with platform ActionLog to detect actions performed outside the platform. Returns match rate, bypass detections, and timing mismatches.',
      parameters: {
        type: 'object',
        properties: {
          days_back: { type: 'integer', description: 'Number of days to look back. Default: 30.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_supplier_performance',
      description: 'Analyze vendor/supplier procurement performance from Canix ERP purchase orders. Returns spend, lead times, and top categories per vendor.',
      parameters: {
        type: 'object',
        properties: {
          vendor_name: { type: 'string', description: 'Filter to a specific vendor by name (optional).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_customer_health',
      description: 'Analyze B2B customer health from Canix ERP sales orders. Returns revenue, order frequency, and churn risk status (active/at_risk/churned).',
      parameters: {
        type: 'object',
        properties: {
          status_filter: { type: 'string', enum: ['active', 'at_risk', 'churned'], description: 'Filter by customer status (optional).' },
        },
      },
    },
  },
  // ---------------------------------------------------------------------------
  // Financial Overlays (Q1, Q21, Q27 — progressive enrichment)
  // ---------------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_inventory_valuation',
      description: 'Get inventory overview with progressive financial enrichment. Always shows package counts, weights, and categories. When cost data is available (ERP, POS, or manual), also shows estimated dollar values per category and total inventory value with source attribution and confidence scores. Answers: "What do we have now? What is it worth?"',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pipeline_valuation',
      description: 'Show material value at each pipeline stage (harvest → processing → testing → retail-ready → in-transit). Always shows weight per stage. When cost data is available, also shows estimated dollar value per stage and percentage of total value. Answers: "What is the value of material currently in each stage of our pipeline?"',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_loss_analysis',
      description: 'Identify where the operation is losing money using operational loss signals: waste rates, idle inventory (90+ days), lab holds, and dead stock (180+ days). When cost data is available, also shows dollar impact per loss category. Answers: "Where are we losing money?"',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_expiring_material',
      description: 'Identify packages at risk of expiring before they can be processed or transferred. Shows days until estimated expiry, quantity at risk, and urgency (critical/warning/watch). When cost data is available, also shows dollar value at risk. Answers: "What material is at risk of expiring before it can be processed?"',
      parameters: {
        type: 'object',
        properties: {
          threshold_days: { type: 'number', description: 'Flag packages expiring within this many days (default: 45).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transfer_loss',
      description: 'Calculate weight loss from harvest through to final product, broken down by stage (harvest waste, processing loss). When cost data is available, adds dollar loss estimates. Answers: "What is my transfer loss from harvest to final product? Where is it occurring?"',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  // ---------------------------------------------------------------------------
  // Operational Intelligence (Q16, Q17, Q19, Q26)
  // ---------------------------------------------------------------------------
  {
    type: 'function',
    function: {
      name: 'get_harvest_forecast',
      description: 'Project which plant batches are ready to harvest within the next N days. Uses strain-level historical cycle times to estimate projected harvest dates, estimated yields, and upcoming capacity. Answers: "What batches are ready to harvest in the next 14 days?"',
      parameters: {
        type: 'object',
        properties: {
          window_days: { type: 'number', description: 'Forecast window in days (default: 14). Show batches projected to be ready within this window.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_cycle_time_analysis',
      description: 'Compute average cycle time (days from plant to harvest) per strain across all historical harvests. Shows mean, median, std deviation, min/max, and trend direction (improving/stable/worsening). Answers: "What is my average days from clone to harvest by strain?"',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_throughput_analysis',
      description: 'Compare harvest intake rate vs processing output rate to identify bottlenecks. Shows average weekly intake, output, raw material backlog, weeks to clear backlog, and imbalance severity. Answers: "What is my processing throughput vs my harvest intake rate?"',
      parameters: {
        type: 'object',
        properties: {
          window_days: { type: 'number', description: 'Analysis window in days (default: 60). Uses this period to calculate average rates.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_plant_compliance',
      description: 'Check active plant counts against license limits and flag compliance risks. Shows total plants by growth phase, percentage of license used, untagged plant alerts, and holds. Answers: "What plants are at risk of compliance issues right now?"',
      parameters: {
        type: 'object',
        properties: {
          plant_limit: { type: 'number', description: 'License plant count limit for this facility. Required for limit-based compliance checks.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ask_knowledge_base',
      description: [
        'Query the Formul8 expert knowledge base for cannabis domain expertise:',
        'compliance regulations (state + federal), formulation science, manufacturing processes,',
        'cultivation best practices, extraction methods, product development, and operational guidance.',
        '',
        'CALL THIS TOOL when the user asks any of:',
        '- "What can we make / produce / formulate?" (formulation feasibility)',
        '- "How should we process [biomass/extract]?" (process recommendations)',
        '- "Is [action] compliant in [state]?" (regulatory questions)',
        '- "What\'s the best practice for [topic]?" (industry guidance)',
        '- Any question requiring domain expertise the facility tools cannot answer.',
        '',
        'CHAIN THIS TOOL after inventory tools to enrich operational answers with expertise.',
        'Example: user asks "what can I make from this biomass?" → first call inventory tools',
        'to see what biomass exists, then call ask_knowledge_base with the inventory summary',
        'embedded in the question to get formulation recommendations grounded in actual stock.',
        '',
        'Pass relevant facility context (state code, current inventory categories, available',
        'biomass types) inside the question so the KB returns concrete, actionable answers.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The knowledge question. Always embed the facility state and any relevant inventory/operational context (e.g., "We have 12kg of trim and 3kg of fresh frozen in MA — which extraction methods are commercially viable and compliant?"). Specific context yields specific answers; bare questions get generic textbook answers.' },
          state: { type: 'string', description: 'Two-letter state code (e.g. "MA", "CO", "CA"). Strongly recommended for any compliance / regulatory question — cannabis rules vary widely by state.' },
        },
        required: ['question'],
      },
    },
  },
];

/**
 * All tools: read-only analysis + write actions.
 *
 * Action tools are hidden from the LLM when ACTIONS_ENABLED is false. The
 * COPILOT_ACTION_TOOLS array stays defined and importable so the executor's
 * ACTION_TOOL_NAMES set still works defensively, but the LLM never sees the
 * schemas and therefore can't request a destructive call. Restoring is one
 * line in src/shared/constants/feature-flags.ts.
 */
export const ALL_COPILOT_TOOLS: ToolDefinition[] = ACTIONS_ENABLED
  ? [...COPILOT_TOOLS, ...COPILOT_ACTION_TOOLS]
  : [...COPILOT_TOOLS];

/**
 * Core tool set for self-hosted LLMs with limited context windows.
 * ~20 tools keeps prompt tokens under 4K, leaving room for system prompt,
 * user messages, and response tokens within a 32K context window.
 * Open-source models (Llama 3.3 70B etc.) struggle with 85+ tool defs —
 * they output tool calls as plain text instead of structured tool_calls.
 */
const CORE_TOOL_NAMES = new Set([
  // Read tools — cover the most common operator questions
  'get_inventory_overview',
  'analyze_aging',
  'get_aging_recommendations',
  'detect_fifo_violations',
  'run_compliance_audit',
  'search_packages',
  'get_harvest_summary',
  'get_active_harvests',
  'get_transfer_summary',
  'get_lab_test_results',
  'get_sales_summary',
  'get_top_products',
  'get_pipeline_summary',
  'get_operations_summary',
  'get_disposition_summary',
  'get_audit_readiness_report',
  // Action tools — most common write operations
  'flag_packages_for_discount',
  'flag_packages_for_testing',
  'log_disposition',
]);

export const CORE_COPILOT_TOOLS: ToolDefinition[] = ALL_COPILOT_TOOLS.filter(
  t => CORE_TOOL_NAMES.has(t.function.name),
);

/** Tool list offered to the LLM; hides tools whose backing service is not configured. */
export function getCopilotToolDefs(): ToolDefinition[] {
  if (process.env.MULTIAGENT_API_URL) return ALL_COPILOT_TOOLS;
  return ALL_COPILOT_TOOLS.filter((t) => t.function.name !== 'ask_knowledge_base');
}
