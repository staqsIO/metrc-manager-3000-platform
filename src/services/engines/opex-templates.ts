/**
 * OpEx Calculator — Default Cannabis Template Definitions
 *
 * Defines the default sections, groups, and cells for a new OpEx model.
 * Each section maps to an OpExSection, groups to OpExCellGroup, cells to OpExCell.
 *
 * Cell key format: "{sectionSlug}.{snake_case_name}"
 * Formula format: "{sectionSlug}.{key} {operator} {sectionSlug}.{key}"
 * Supported operators: +, -, *, /, SUM(), IF(), ROUND(), MIN(), MAX()
 */

export interface TemplateCell {
  key: string;
  label: string;
  cellType: 'INPUT' | 'COMPUTED' | 'CONSTANT';
  dataType: 'number' | 'currency' | 'percent' | 'text';
  defaultValue?: number;
  formula?: string;
  dependsOn?: string[];
  unit?: string;
  precision?: number;
  minValue?: number;
  maxValue?: number;
  tooltip?: string;
}

export interface TemplateCellGroup {
  label: string;
  cells: TemplateCell[];
}

export interface TemplateSection {
  name: string;
  slug: string;
  icon: string; // lucide-react icon name
  groups: TemplateCellGroup[];
  subSections?: TemplateSection[];
}

export interface OpExTemplate {
  name: string;
  description: string;
  sections: TemplateSection[];
  kpiCells: string[]; // 6 cell keys that populate the footer
}

// ============================================================
// DEFAULT CANNABIS OPERATIONS TEMPLATE
// ============================================================

export const DEFAULT_CANNABIS_TEMPLATE: OpExTemplate = {
  name: 'Cannabis Operations - Standard',
  description: 'General cannabis operations cost model covering cultivation through retail',
  kpiCells: [
    'pnl.annual_revenue',
    'pnl.total_annual_cost',
    'pnl.cost_per_pound',
    'pnl.gross_margin_pct',
    'pnl.gross_profit',
    'pnl.taxable_profit',
  ],
  sections: [
    // -------------------------------------------------------
    // 1. CORE ASSUMPTIONS
    // -------------------------------------------------------
    {
      name: 'Core Assumptions',
      slug: 'core',
      icon: 'settings',
      groups: [
        {
          label: 'Production',
          cells: [
            {
              key: 'core.annual_harvests',
              label: 'Harvests Per Year',
              cellType: 'INPUT',
              dataType: 'number',
              defaultValue: 6,
              unit: 'harvests',
              precision: 0,
              minValue: 1,
              maxValue: 12,
              tooltip: 'Number of harvest cycles per year',
            },
            {
              key: 'core.yield_per_harvest_lbs',
              label: 'Yield Per Harvest',
              cellType: 'INPUT',
              dataType: 'number',
              defaultValue: 100,
              unit: 'lbs',
              precision: 1,
              tooltip: 'Dry weight output per harvest cycle',
            },
            {
              key: 'core.annual_yield_lbs',
              label: 'Annual Yield',
              cellType: 'COMPUTED',
              dataType: 'number',
              formula: 'core.annual_harvests * core.yield_per_harvest_lbs',
              dependsOn: ['core.annual_harvests', 'core.yield_per_harvest_lbs'],
              unit: 'lbs',
              precision: 0,
            },
            {
              key: 'core.canopy_sqft',
              label: 'Canopy Size',
              cellType: 'INPUT',
              dataType: 'number',
              defaultValue: 5000,
              unit: 'sq ft',
              precision: 0,
              tooltip: 'Active flowering canopy square footage',
            },
            {
              key: 'core.yield_per_sqft',
              label: 'Yield Per Sq Ft (Annual)',
              cellType: 'COMPUTED',
              dataType: 'number',
              formula: 'core.annual_yield_lbs / core.canopy_sqft',
              dependsOn: ['core.annual_yield_lbs', 'core.canopy_sqft'],
              unit: 'lbs/sqft',
              precision: 2,
            },
          ],
        },
        {
          label: 'Pricing',
          cells: [
            {
              key: 'core.avg_price_per_lb',
              label: 'Average Price Per Pound',
              cellType: 'INPUT',
              dataType: 'currency',
              defaultValue: 1200,
              unit: '$/lb',
              precision: 0,
              tooltip: 'Blended wholesale price across all product types',
            },
            {
              key: 'core.annual_revenue',
              label: 'Gross Annual Revenue',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_yield_lbs * core.avg_price_per_lb',
              dependsOn: ['core.annual_yield_lbs', 'core.avg_price_per_lb'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 2. CONSTANTS
    // -------------------------------------------------------
    {
      name: 'Constants',
      slug: 'constants',
      icon: 'lock',
      groups: [
        {
          label: 'Time & Calendar',
          cells: [
            { key: 'constants.hours_per_year', label: 'Hours Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 8760, unit: 'hrs', precision: 0 },
            { key: 'constants.weeks_per_year', label: 'Weeks Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 52, unit: 'weeks', precision: 0 },
            { key: 'constants.days_per_year', label: 'Days Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 365, unit: 'days', precision: 0 },
          ],
        },
        {
          label: 'Conversions',
          cells: [
            { key: 'constants.grams_per_lb', label: 'Grams Per Pound', cellType: 'CONSTANT', dataType: 'number', defaultValue: 453.592, unit: 'g', precision: 3 },
            { key: 'constants.oz_per_lb', label: 'Ounces Per Pound', cellType: 'CONSTANT', dataType: 'number', defaultValue: 16, unit: 'oz', precision: 0 },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 3. CULTIVATION
    // -------------------------------------------------------
    {
      name: 'Cultivation',
      slug: 'cultivation',
      icon: 'sprout',
      groups: [
        {
          label: 'Grow Media & Nutrients',
          cells: [
            { key: 'cultivation.media_cost_per_harvest', label: 'Grow Media Cost Per Harvest', cellType: 'INPUT', dataType: 'currency', defaultValue: 2500, unit: '$', precision: 0 },
            { key: 'cultivation.nutrient_cost_per_harvest', label: 'Nutrient Cost Per Harvest', cellType: 'INPUT', dataType: 'currency', defaultValue: 3000, unit: '$', precision: 0 },
            {
              key: 'cultivation.annual_media_cost',
              label: 'Annual Media Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'cultivation.media_cost_per_harvest * core.annual_harvests',
              dependsOn: ['cultivation.media_cost_per_harvest', 'core.annual_harvests'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'cultivation.annual_nutrient_cost',
              label: 'Annual Nutrient Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'cultivation.nutrient_cost_per_harvest * core.annual_harvests',
              dependsOn: ['cultivation.nutrient_cost_per_harvest', 'core.annual_harvests'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Plant Inputs',
          cells: [
            { key: 'cultivation.clones_per_harvest', label: 'Clones Per Harvest', cellType: 'INPUT', dataType: 'number', defaultValue: 200, unit: 'plants', precision: 0 },
            { key: 'cultivation.cost_per_clone', label: 'Cost Per Clone', cellType: 'INPUT', dataType: 'currency', defaultValue: 8, unit: '$/clone', precision: 2 },
            {
              key: 'cultivation.annual_clone_cost',
              label: 'Annual Clone Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'cultivation.clones_per_harvest * cultivation.cost_per_clone * core.annual_harvests',
              dependsOn: ['cultivation.clones_per_harvest', 'cultivation.cost_per_clone', 'core.annual_harvests'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'IPM & Pest Control',
          cells: [
            { key: 'cultivation.ipm_monthly_cost', label: 'IPM Monthly Budget', cellType: 'INPUT', dataType: 'currency', defaultValue: 1500, unit: '$/mo', precision: 0 },
            {
              key: 'cultivation.annual_ipm_cost',
              label: 'Annual IPM Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'cultivation.ipm_monthly_cost * 12',
              dependsOn: ['cultivation.ipm_monthly_cost'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
      subSections: [
        {
          name: 'Environmental Controls',
          slug: 'cultivation-env',
          icon: 'thermometer',
          groups: [
            {
              label: 'HVAC',
              cells: [
                { key: 'cultivation-env.hvac_monthly_maint', label: 'HVAC Monthly Maintenance', cellType: 'INPUT', dataType: 'currency', defaultValue: 800, unit: '$/mo', precision: 0 },
                {
                  key: 'cultivation-env.annual_hvac_maint',
                  label: 'Annual HVAC Maintenance',
                  cellType: 'COMPUTED',
                  dataType: 'currency',
                  formula: 'cultivation-env.hvac_monthly_maint * 12',
                  dependsOn: ['cultivation-env.hvac_monthly_maint'],
                  unit: '$',
                  precision: 0,
                },
              ],
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 4. POST-HARVEST
    // -------------------------------------------------------
    {
      name: 'Post-Harvest',
      slug: 'postharvest',
      icon: 'scissors',
      groups: [
        {
          label: 'Processing Costs',
          cells: [
            { key: 'postharvest.trim_cost_per_lb', label: 'Trim Cost Per Pound', cellType: 'INPUT', dataType: 'currency', defaultValue: 150, unit: '$/lb', precision: 0 },
            { key: 'postharvest.packaging_cost_per_lb', label: 'Packaging Cost Per Pound', cellType: 'INPUT', dataType: 'currency', defaultValue: 25, unit: '$/lb', precision: 0 },
            { key: 'postharvest.testing_cost_per_batch', label: 'Lab Testing Per Batch', cellType: 'INPUT', dataType: 'currency', defaultValue: 800, unit: '$/batch', precision: 0 },
            { key: 'postharvest.batches_per_harvest', label: 'Batches Per Harvest', cellType: 'INPUT', dataType: 'number', defaultValue: 5, unit: 'batches', precision: 0 },
            {
              key: 'postharvest.annual_trim_cost',
              label: 'Annual Trim Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'postharvest.trim_cost_per_lb * core.annual_yield_lbs',
              dependsOn: ['postharvest.trim_cost_per_lb', 'core.annual_yield_lbs'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'postharvest.annual_packaging_cost',
              label: 'Annual Packaging Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'postharvest.packaging_cost_per_lb * core.annual_yield_lbs',
              dependsOn: ['postharvest.packaging_cost_per_lb', 'core.annual_yield_lbs'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'postharvest.annual_testing_cost',
              label: 'Annual Testing Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'postharvest.testing_cost_per_batch * postharvest.batches_per_harvest * core.annual_harvests',
              dependsOn: ['postharvest.testing_cost_per_batch', 'postharvest.batches_per_harvest', 'core.annual_harvests'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 5. LABOR
    // -------------------------------------------------------
    {
      name: 'Labor',
      slug: 'labor',
      icon: 'users',
      groups: [
        {
          label: 'Cultivation Staff',
          cells: [
            { key: 'labor.growers_count', label: 'Growers', cellType: 'INPUT', dataType: 'number', defaultValue: 3, unit: 'FTE', precision: 0 },
            { key: 'labor.grower_hourly', label: 'Grower Hourly Rate', cellType: 'INPUT', dataType: 'currency', defaultValue: 22, unit: '$/hr', precision: 2 },
            { key: 'labor.grower_hours_week', label: 'Hours Per Week', cellType: 'INPUT', dataType: 'number', defaultValue: 40, unit: 'hrs/wk', precision: 0 },
            {
              key: 'labor.annual_grower_cost',
              label: 'Annual Grower Labor',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'labor.growers_count * labor.grower_hourly * labor.grower_hours_week * constants.weeks_per_year',
              dependsOn: ['labor.growers_count', 'labor.grower_hourly', 'labor.grower_hours_week', 'constants.weeks_per_year'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Processing Staff',
          cells: [
            { key: 'labor.trimmers_count', label: 'Trimmers', cellType: 'INPUT', dataType: 'number', defaultValue: 4, unit: 'FTE', precision: 0 },
            { key: 'labor.trimmer_hourly', label: 'Trimmer Hourly Rate', cellType: 'INPUT', dataType: 'currency', defaultValue: 18, unit: '$/hr', precision: 2 },
            { key: 'labor.trimmer_hours_week', label: 'Hours Per Week', cellType: 'INPUT', dataType: 'number', defaultValue: 40, unit: 'hrs/wk', precision: 0 },
            {
              key: 'labor.annual_trimmer_cost',
              label: 'Annual Trimmer Labor',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'labor.trimmers_count * labor.trimmer_hourly * labor.trimmer_hours_week * constants.weeks_per_year',
              dependsOn: ['labor.trimmers_count', 'labor.trimmer_hourly', 'labor.trimmer_hours_week', 'constants.weeks_per_year'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Management',
          cells: [
            { key: 'labor.manager_salary', label: 'Facility Manager Salary', cellType: 'INPUT', dataType: 'currency', defaultValue: 75000, unit: '$/yr', precision: 0 },
            { key: 'labor.benefits_pct', label: 'Benefits Overhead', cellType: 'INPUT', dataType: 'percent', defaultValue: 25, unit: '%', precision: 0, tooltip: 'Added to all wages for benefits, taxes, insurance' },
            {
              key: 'labor.total_annual_labor',
              label: 'Total Annual Labor (with benefits)',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(labor.annual_grower_cost + labor.annual_trimmer_cost + labor.manager_salary) * (1 + labor.benefits_pct / 100)',
              dependsOn: ['labor.annual_grower_cost', 'labor.annual_trimmer_cost', 'labor.manager_salary', 'labor.benefits_pct'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 6. CONSUMABLES
    // -------------------------------------------------------
    {
      name: 'Consumables',
      slug: 'consumables',
      icon: 'package',
      groups: [
        {
          label: 'Grow Supplies',
          cells: [
            { key: 'consumables.gloves_monthly', label: 'Gloves Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 200, unit: '$/mo', precision: 0 },
            { key: 'consumables.cleaning_monthly', label: 'Cleaning Supplies Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 300, unit: '$/mo', precision: 0 },
            { key: 'consumables.misc_monthly', label: 'Misc Consumables Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 500, unit: '$/mo', precision: 0 },
            {
              key: 'consumables.annual_total',
              label: 'Annual Consumables',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(consumables.gloves_monthly + consumables.cleaning_monthly + consumables.misc_monthly) * 12',
              dependsOn: ['consumables.gloves_monthly', 'consumables.cleaning_monthly', 'consumables.misc_monthly'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 7. UTILITIES
    // -------------------------------------------------------
    {
      name: 'Utilities',
      slug: 'utilities',
      icon: 'zap',
      groups: [
        {
          label: 'Electricity',
          cells: [
            { key: 'utilities.kwh_rate', label: 'Electricity Rate', cellType: 'INPUT', dataType: 'currency', defaultValue: 0.14, unit: '$/kWh', precision: 3 },
            { key: 'utilities.monthly_kwh', label: 'Monthly Usage', cellType: 'INPUT', dataType: 'number', defaultValue: 25000, unit: 'kWh', precision: 0 },
            {
              key: 'utilities.annual_electricity',
              label: 'Annual Electricity',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'utilities.kwh_rate * utilities.monthly_kwh * 12',
              dependsOn: ['utilities.kwh_rate', 'utilities.monthly_kwh'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Water & Gas',
          cells: [
            { key: 'utilities.water_monthly', label: 'Water Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 800, unit: '$/mo', precision: 0 },
            { key: 'utilities.gas_monthly', label: 'Gas/Propane Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 400, unit: '$/mo', precision: 0 },
            {
              key: 'utilities.annual_water_gas',
              label: 'Annual Water & Gas',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(utilities.water_monthly + utilities.gas_monthly) * 12',
              dependsOn: ['utilities.water_monthly', 'utilities.gas_monthly'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Totals',
          cells: [
            {
              key: 'utilities.annual_total',
              label: 'Total Annual Utilities',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'utilities.annual_electricity + utilities.annual_water_gas',
              dependsOn: ['utilities.annual_electricity', 'utilities.annual_water_gas'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 8. FACILITY & OVERHEAD
    // -------------------------------------------------------
    {
      name: 'Facility & Overhead',
      slug: 'facility',
      icon: 'building',
      groups: [
        {
          label: 'Rent & Insurance',
          cells: [
            { key: 'facility.rent_monthly', label: 'Rent/Mortgage Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 8000, unit: '$/mo', precision: 0 },
            { key: 'facility.insurance_monthly', label: 'Insurance Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 2000, unit: '$/mo', precision: 0 },
            { key: 'facility.security_monthly', label: 'Security Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 1500, unit: '$/mo', precision: 0 },
          ],
        },
        {
          label: 'Compliance & Licensing',
          cells: [
            { key: 'facility.license_annual', label: 'Annual License Fees', cellType: 'INPUT', dataType: 'currency', defaultValue: 15000, unit: '$/yr', precision: 0 },
            { key: 'facility.metrc_monthly', label: 'Metrc/Track-and-Trace Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 200, unit: '$/mo', precision: 0 },
            { key: 'facility.compliance_annual', label: 'Compliance Consulting', cellType: 'INPUT', dataType: 'currency', defaultValue: 5000, unit: '$/yr', precision: 0 },
          ],
        },
        {
          label: 'Totals',
          cells: [
            {
              key: 'facility.annual_total',
              label: 'Total Annual Facility Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(facility.rent_monthly + facility.insurance_monthly + facility.security_monthly + facility.metrc_monthly) * 12 + facility.license_annual + facility.compliance_annual',
              dependsOn: ['facility.rent_monthly', 'facility.insurance_monthly', 'facility.security_monthly', 'facility.metrc_monthly', 'facility.license_annual', 'facility.compliance_annual'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 9. TAXES
    // -------------------------------------------------------
    {
      name: 'Taxes',
      slug: 'taxes',
      icon: 'receipt',
      groups: [
        {
          label: 'Cannabis Taxes',
          cells: [
            { key: 'taxes.excise_tax_pct', label: 'Excise Tax Rate', cellType: 'INPUT', dataType: 'percent', defaultValue: 15, unit: '%', precision: 1, tooltip: 'State excise tax on cannabis sales' },
            { key: 'taxes.cultivation_tax_per_oz', label: 'Cultivation Tax Per Oz', cellType: 'INPUT', dataType: 'currency', defaultValue: 0, unit: '$/oz', precision: 2, tooltip: 'Some states impose per-ounce cultivation tax (CA repealed 7/1/2022)' },
            { key: 'taxes.local_tax_pct', label: 'Local/City Tax Rate', cellType: 'INPUT', dataType: 'percent', defaultValue: 5, unit: '%', precision: 1 },
            {
              key: 'taxes.annual_excise',
              label: 'Annual Excise Tax',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue * taxes.excise_tax_pct / 100',
              dependsOn: ['core.annual_revenue', 'taxes.excise_tax_pct'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'taxes.annual_cultivation_tax',
              label: 'Annual Cultivation Tax',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'taxes.cultivation_tax_per_oz * core.annual_yield_lbs * constants.oz_per_lb',
              dependsOn: ['taxes.cultivation_tax_per_oz', 'core.annual_yield_lbs', 'constants.oz_per_lb'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'taxes.annual_local',
              label: 'Annual Local Tax',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue * taxes.local_tax_pct / 100',
              dependsOn: ['core.annual_revenue', 'taxes.local_tax_pct'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'taxes.total_annual_tax',
              label: 'Total Annual Tax Burden',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'taxes.annual_excise + taxes.annual_cultivation_tax + taxes.annual_local',
              dependsOn: ['taxes.annual_excise', 'taxes.annual_cultivation_tax', 'taxes.annual_local'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 10. P&L (KPI SECTION)
    // -------------------------------------------------------
    {
      name: 'Profit & Loss',
      slug: 'pnl',
      icon: 'trending-up',
      groups: [
        {
          label: 'Summary',
          cells: [
            {
              key: 'pnl.annual_revenue',
              label: 'Annual Revenue',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue',
              dependsOn: ['core.annual_revenue'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.total_annual_cost',
              label: 'Total Annual Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'cultivation.annual_media_cost + cultivation.annual_nutrient_cost + cultivation.annual_clone_cost + cultivation.annual_ipm_cost + cultivation-env.annual_hvac_maint + postharvest.annual_trim_cost + postharvest.annual_packaging_cost + postharvest.annual_testing_cost + labor.total_annual_labor + consumables.annual_total + utilities.annual_total + facility.annual_total + taxes.total_annual_tax',
              dependsOn: [
                'cultivation.annual_media_cost', 'cultivation.annual_nutrient_cost', 'cultivation.annual_clone_cost', 'cultivation.annual_ipm_cost',
                'cultivation-env.annual_hvac_maint',
                'postharvest.annual_trim_cost', 'postharvest.annual_packaging_cost', 'postharvest.annual_testing_cost',
                'labor.total_annual_labor', 'consumables.annual_total', 'utilities.annual_total', 'facility.annual_total', 'taxes.total_annual_tax',
              ],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.cost_per_pound',
              label: 'Cost Per Pound',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.total_annual_cost / core.annual_yield_lbs',
              dependsOn: ['pnl.total_annual_cost', 'core.annual_yield_lbs'],
              unit: '$/lb',
              precision: 2,
            },
            {
              key: 'pnl.gross_profit',
              label: 'Gross Profit',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.annual_revenue - pnl.total_annual_cost',
              dependsOn: ['pnl.annual_revenue', 'pnl.total_annual_cost'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.gross_margin_pct',
              label: 'Gross Margin',
              cellType: 'COMPUTED',
              dataType: 'percent',
              formula: '(pnl.gross_profit / pnl.annual_revenue) * 100',
              dependsOn: ['pnl.gross_profit', 'pnl.annual_revenue'],
              unit: '%',
              precision: 1,
            },
            {
              key: 'pnl.taxable_profit',
              label: 'Taxable Profit (Pre-280E)',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.annual_revenue - (pnl.total_annual_cost - taxes.total_annual_tax)',
              dependsOn: ['pnl.annual_revenue', 'pnl.total_annual_cost', 'taxes.total_annual_tax'],
              unit: '$',
              precision: 0,
              tooltip: 'Revenue minus non-tax COGS. 280E limits deductions for cannabis businesses.',
            },
          ],
        },
      ],
    },
  ],
};

// ============================================================
// MANUFACTURER TEMPLATE
// ============================================================

export const MANUFACTURER_TEMPLATE: OpExTemplate = {
  name: 'Cannabis Manufacturing Operations',
  description: 'Cost model for cannabis extraction, processing, and manufacturing',
  kpiCells: [
    'pnl.annual_revenue',
    'pnl.total_annual_cost',
    'pnl.cost_per_unit',
    'pnl.gross_margin_pct',
    'pnl.gross_profit',
    'pnl.taxable_profit',
  ],
  sections: [
    // -------------------------------------------------------
    // 1. CORE ASSUMPTIONS
    // -------------------------------------------------------
    {
      name: 'Core Assumptions',
      slug: 'core',
      icon: 'settings',
      groups: [
        {
          label: 'Production',
          cells: [
            {
              key: 'core.monthly_output_units',
              label: 'Monthly Output Units',
              cellType: 'INPUT',
              dataType: 'number',
              defaultValue: 5000,
              unit: 'units',
              precision: 0,
              tooltip: 'Number of finished product units produced per month',
            },
            {
              key: 'core.wholesale_price_per_unit',
              label: 'Wholesale Price Per Unit',
              cellType: 'INPUT',
              dataType: 'currency',
              defaultValue: 15,
              unit: '$/unit',
              precision: 2,
              tooltip: 'Average wholesale price per finished unit',
            },
            {
              key: 'core.annual_output_units',
              label: 'Annual Output Units',
              cellType: 'COMPUTED',
              dataType: 'number',
              formula: 'core.monthly_output_units * 12',
              dependsOn: ['core.monthly_output_units'],
              unit: 'units',
              precision: 0,
            },
            {
              key: 'core.annual_revenue',
              label: 'Gross Annual Revenue',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_output_units * core.wholesale_price_per_unit',
              dependsOn: ['core.annual_output_units', 'core.wholesale_price_per_unit'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 2. CONSTANTS
    // -------------------------------------------------------
    {
      name: 'Constants',
      slug: 'constants',
      icon: 'lock',
      groups: [
        {
          label: 'Time & Calendar',
          cells: [
            { key: 'constants.hours_per_year', label: 'Hours Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 8760, unit: 'hrs', precision: 0 },
            { key: 'constants.weeks_per_year', label: 'Weeks Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 52, unit: 'weeks', precision: 0 },
            { key: 'constants.days_per_year', label: 'Days Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 365, unit: 'days', precision: 0 },
          ],
        },
        {
          label: 'Conversions',
          cells: [
            { key: 'constants.grams_per_lb', label: 'Grams Per Pound', cellType: 'CONSTANT', dataType: 'number', defaultValue: 453.592, unit: 'g', precision: 3 },
            { key: 'constants.oz_per_lb', label: 'Ounces Per Pound', cellType: 'CONSTANT', dataType: 'number', defaultValue: 16, unit: 'oz', precision: 0 },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 3. PROCESSING
    // -------------------------------------------------------
    {
      name: 'Processing',
      slug: 'processing',
      icon: 'flask-conical',
      groups: [
        {
          label: 'Raw Material',
          cells: [
            { key: 'processing.input_material_cost_per_lb', label: 'Input Material Cost Per Lb', cellType: 'INPUT', dataType: 'currency', defaultValue: 800, unit: '$/lb', precision: 0, tooltip: 'Cost of raw cannabis material per pound' },
            { key: 'processing.lbs_per_month', label: 'Lbs Per Month', cellType: 'INPUT', dataType: 'number', defaultValue: 200, unit: 'lbs', precision: 0 },
            {
              key: 'processing.annual_material_cost',
              label: 'Annual Material Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'processing.input_material_cost_per_lb * processing.lbs_per_month * 12',
              dependsOn: ['processing.input_material_cost_per_lb', 'processing.lbs_per_month'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Extraction',
          cells: [
            { key: 'processing.solvent_cost_monthly', label: 'Solvent Cost Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 3000, unit: '$/mo', precision: 0 },
            { key: 'processing.equipment_maint_monthly', label: 'Equipment Maintenance Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 2000, unit: '$/mo', precision: 0 },
            {
              key: 'processing.annual_extraction_cost',
              label: 'Annual Extraction Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(processing.solvent_cost_monthly + processing.equipment_maint_monthly) * 12',
              dependsOn: ['processing.solvent_cost_monthly', 'processing.equipment_maint_monthly'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 4. QA & COMPLIANCE
    // -------------------------------------------------------
    {
      name: 'QA & Compliance',
      slug: 'qa',
      icon: 'shield-check',
      groups: [
        {
          label: 'Testing',
          cells: [
            { key: 'qa.tests_per_month', label: 'Tests Per Month', cellType: 'INPUT', dataType: 'number', defaultValue: 20, unit: 'tests', precision: 0 },
            { key: 'qa.cost_per_test', label: 'Cost Per Test', cellType: 'INPUT', dataType: 'currency', defaultValue: 250, unit: '$/test', precision: 0 },
            {
              key: 'qa.annual_testing_cost',
              label: 'Annual Testing Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'qa.tests_per_month * qa.cost_per_test * 12',
              dependsOn: ['qa.tests_per_month', 'qa.cost_per_test'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Compliance',
          cells: [
            { key: 'qa.license_annual', label: 'Annual License Fees', cellType: 'INPUT', dataType: 'currency', defaultValue: 15000, unit: '$/yr', precision: 0 },
            { key: 'qa.compliance_annual', label: 'Compliance Consulting', cellType: 'INPUT', dataType: 'currency', defaultValue: 5000, unit: '$/yr', precision: 0 },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 5. LABOR
    // -------------------------------------------------------
    {
      name: 'Labor',
      slug: 'labor',
      icon: 'users',
      groups: [
        {
          label: 'Extraction Staff',
          cells: [
            { key: 'labor.extractors_count', label: 'Extractors', cellType: 'INPUT', dataType: 'number', defaultValue: 3, unit: 'FTE', precision: 0 },
            { key: 'labor.extractor_hourly', label: 'Extractor Hourly Rate', cellType: 'INPUT', dataType: 'currency', defaultValue: 28, unit: '$/hr', precision: 2 },
            { key: 'labor.hours_week', label: 'Hours Per Week', cellType: 'INPUT', dataType: 'number', defaultValue: 40, unit: 'hrs/wk', precision: 0 },
            {
              key: 'labor.annual_extractor_cost',
              label: 'Annual Extractor Labor',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'labor.extractors_count * labor.extractor_hourly * labor.hours_week * constants.weeks_per_year',
              dependsOn: ['labor.extractors_count', 'labor.extractor_hourly', 'labor.hours_week', 'constants.weeks_per_year'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'QA Staff',
          cells: [
            { key: 'labor.qa_staff_count', label: 'QA Staff', cellType: 'INPUT', dataType: 'number', defaultValue: 2, unit: 'FTE', precision: 0 },
            { key: 'labor.qa_hourly', label: 'QA Hourly Rate', cellType: 'INPUT', dataType: 'currency', defaultValue: 25, unit: '$/hr', precision: 2 },
            { key: 'labor.qa_hours_week', label: 'QA Hours Per Week', cellType: 'INPUT', dataType: 'number', defaultValue: 40, unit: 'hrs/wk', precision: 0 },
            {
              key: 'labor.annual_qa_cost',
              label: 'Annual QA Labor',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'labor.qa_staff_count * labor.qa_hourly * labor.qa_hours_week * constants.weeks_per_year',
              dependsOn: ['labor.qa_staff_count', 'labor.qa_hourly', 'labor.qa_hours_week', 'constants.weeks_per_year'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Management',
          cells: [
            { key: 'labor.manager_salary', label: 'Facility Manager Salary', cellType: 'INPUT', dataType: 'currency', defaultValue: 75000, unit: '$/yr', precision: 0 },
            { key: 'labor.benefits_pct', label: 'Benefits Overhead', cellType: 'INPUT', dataType: 'percent', defaultValue: 25, unit: '%', precision: 0, tooltip: 'Added to all wages for benefits, taxes, insurance' },
            {
              key: 'labor.total_annual_labor',
              label: 'Total Annual Labor (with benefits)',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(labor.annual_extractor_cost + labor.annual_qa_cost + labor.manager_salary) * (1 + labor.benefits_pct / 100)',
              dependsOn: ['labor.annual_extractor_cost', 'labor.annual_qa_cost', 'labor.manager_salary', 'labor.benefits_pct'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 6. FACILITY & OVERHEAD
    // -------------------------------------------------------
    {
      name: 'Facility & Overhead',
      slug: 'facility',
      icon: 'building',
      groups: [
        {
          label: 'Rent & Insurance',
          cells: [
            { key: 'facility.rent_monthly', label: 'Rent/Mortgage Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 8000, unit: '$/mo', precision: 0 },
            { key: 'facility.insurance_monthly', label: 'Insurance Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 2000, unit: '$/mo', precision: 0 },
            { key: 'facility.security_monthly', label: 'Security Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 1500, unit: '$/mo', precision: 0 },
          ],
        },
        {
          label: 'Compliance & Licensing',
          cells: [
            { key: 'facility.license_annual', label: 'Annual License Fees', cellType: 'INPUT', dataType: 'currency', defaultValue: 15000, unit: '$/yr', precision: 0 },
            { key: 'facility.metrc_monthly', label: 'Metrc/Track-and-Trace Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 200, unit: '$/mo', precision: 0 },
            { key: 'facility.compliance_annual', label: 'Compliance Consulting', cellType: 'INPUT', dataType: 'currency', defaultValue: 5000, unit: '$/yr', precision: 0 },
          ],
        },
        {
          label: 'Totals',
          cells: [
            {
              key: 'facility.annual_total',
              label: 'Total Annual Facility Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(facility.rent_monthly + facility.insurance_monthly + facility.security_monthly + facility.metrc_monthly) * 12 + facility.license_annual + facility.compliance_annual',
              dependsOn: ['facility.rent_monthly', 'facility.insurance_monthly', 'facility.security_monthly', 'facility.metrc_monthly', 'facility.license_annual', 'facility.compliance_annual'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 7. UTILITIES
    // -------------------------------------------------------
    {
      name: 'Utilities',
      slug: 'utilities',
      icon: 'zap',
      groups: [
        {
          label: 'Electricity',
          cells: [
            { key: 'utilities.kwh_rate', label: 'Electricity Rate', cellType: 'INPUT', dataType: 'currency', defaultValue: 0.14, unit: '$/kWh', precision: 3 },
            { key: 'utilities.monthly_kwh', label: 'Monthly Usage', cellType: 'INPUT', dataType: 'number', defaultValue: 25000, unit: 'kWh', precision: 0 },
            {
              key: 'utilities.annual_electricity',
              label: 'Annual Electricity',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'utilities.kwh_rate * utilities.monthly_kwh * 12',
              dependsOn: ['utilities.kwh_rate', 'utilities.monthly_kwh'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Water & Gas',
          cells: [
            { key: 'utilities.water_monthly', label: 'Water Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 800, unit: '$/mo', precision: 0 },
            { key: 'utilities.gas_monthly', label: 'Gas/Propane Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 400, unit: '$/mo', precision: 0 },
            {
              key: 'utilities.annual_water_gas',
              label: 'Annual Water & Gas',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(utilities.water_monthly + utilities.gas_monthly) * 12',
              dependsOn: ['utilities.water_monthly', 'utilities.gas_monthly'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Totals',
          cells: [
            {
              key: 'utilities.annual_total',
              label: 'Total Annual Utilities',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'utilities.annual_electricity + utilities.annual_water_gas',
              dependsOn: ['utilities.annual_electricity', 'utilities.annual_water_gas'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 8. TAXES
    // -------------------------------------------------------
    {
      name: 'Taxes',
      slug: 'taxes',
      icon: 'receipt',
      groups: [
        {
          label: 'Cannabis Taxes',
          cells: [
            { key: 'taxes.excise_tax_pct', label: 'Excise Tax Rate', cellType: 'INPUT', dataType: 'percent', defaultValue: 15, unit: '%', precision: 1, tooltip: 'State excise tax on cannabis sales' },
            { key: 'taxes.local_tax_pct', label: 'Local/City Tax Rate', cellType: 'INPUT', dataType: 'percent', defaultValue: 5, unit: '%', precision: 1 },
            {
              key: 'taxes.annual_excise',
              label: 'Annual Excise Tax',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue * taxes.excise_tax_pct / 100',
              dependsOn: ['core.annual_revenue', 'taxes.excise_tax_pct'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'taxes.annual_local',
              label: 'Annual Local Tax',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue * taxes.local_tax_pct / 100',
              dependsOn: ['core.annual_revenue', 'taxes.local_tax_pct'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'taxes.total_annual_tax',
              label: 'Total Annual Tax Burden',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'taxes.annual_excise + taxes.annual_local',
              dependsOn: ['taxes.annual_excise', 'taxes.annual_local'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 9. P&L (KPI SECTION)
    // -------------------------------------------------------
    {
      name: 'Profit & Loss',
      slug: 'pnl',
      icon: 'trending-up',
      groups: [
        {
          label: 'Summary',
          cells: [
            {
              key: 'pnl.annual_revenue',
              label: 'Annual Revenue',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue',
              dependsOn: ['core.annual_revenue'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.total_annual_cost',
              label: 'Total Annual Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'processing.annual_material_cost + processing.annual_extraction_cost + qa.annual_testing_cost + qa.license_annual + qa.compliance_annual + labor.total_annual_labor + facility.annual_total + utilities.annual_total + taxes.total_annual_tax',
              dependsOn: [
                'processing.annual_material_cost', 'processing.annual_extraction_cost',
                'qa.annual_testing_cost', 'qa.license_annual', 'qa.compliance_annual',
                'labor.total_annual_labor', 'facility.annual_total', 'utilities.annual_total', 'taxes.total_annual_tax',
              ],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.cost_per_unit',
              label: 'Cost Per Unit',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.total_annual_cost / core.annual_output_units',
              dependsOn: ['pnl.total_annual_cost', 'core.annual_output_units'],
              unit: '$/unit',
              precision: 2,
            },
            {
              key: 'pnl.gross_profit',
              label: 'Gross Profit',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.annual_revenue - pnl.total_annual_cost',
              dependsOn: ['pnl.annual_revenue', 'pnl.total_annual_cost'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.gross_margin_pct',
              label: 'Gross Margin',
              cellType: 'COMPUTED',
              dataType: 'percent',
              formula: '(pnl.gross_profit / pnl.annual_revenue) * 100',
              dependsOn: ['pnl.gross_profit', 'pnl.annual_revenue'],
              unit: '%',
              precision: 1,
            },
            {
              key: 'pnl.taxable_profit',
              label: 'Taxable Profit (Pre-280E)',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.annual_revenue - (pnl.total_annual_cost - taxes.total_annual_tax)',
              dependsOn: ['pnl.annual_revenue', 'pnl.total_annual_cost', 'taxes.total_annual_tax'],
              unit: '$',
              precision: 0,
              tooltip: 'Revenue minus non-tax COGS. 280E limits deductions for cannabis businesses.',
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 10. INTER-COMPANY TRANSFERS
    // -------------------------------------------------------
    {
      name: 'Inter-Company Transfers',
      slug: 'transfers',
      icon: 'arrow-left-right',
      groups: [
        {
          label: 'Transfer Prices',
          cells: [
            {
              key: 'transfers.transfer_price_from_cultivator',
              label: 'Transfer Price from Cultivator',
              cellType: 'INPUT',
              dataType: 'currency',
              defaultValue: 800,
              unit: '$/lb',
              precision: 0,
              tooltip: 'Manual transfer price inputs for vertically integrated operations',
            },
            {
              key: 'transfers.transfer_price_to_dispensary',
              label: 'Transfer Price to Dispensary',
              cellType: 'INPUT',
              dataType: 'currency',
              defaultValue: 0,
              unit: '$/unit',
              precision: 0,
            },
            {
              key: 'transfers.notes',
              label: 'Transfer Notes',
              cellType: 'INPUT',
              dataType: 'text',
              tooltip: 'Manual transfer price inputs for vertically integrated operations',
            },
          ],
        },
      ],
    },
  ],
};

// ============================================================
// DISPENSARY TEMPLATE
// ============================================================

export const DISPENSARY_TEMPLATE: OpExTemplate = {
  name: 'Cannabis Retail/Dispensary Operations',
  description: 'Cost model for cannabis dispensary and retail operations',
  kpiCells: [
    'pnl.annual_revenue',
    'pnl.total_annual_cost',
    'pnl.cost_per_transaction',
    'pnl.gross_margin_pct',
    'pnl.gross_profit',
    'pnl.taxable_profit',
  ],
  sections: [
    // -------------------------------------------------------
    // 1. CORE ASSUMPTIONS
    // -------------------------------------------------------
    {
      name: 'Core Assumptions',
      slug: 'core',
      icon: 'settings',
      groups: [
        {
          label: 'Revenue',
          cells: [
            {
              key: 'core.daily_transactions',
              label: 'Daily Transactions',
              cellType: 'INPUT',
              dataType: 'number',
              defaultValue: 150,
              unit: 'transactions',
              precision: 0,
              tooltip: 'Average number of customer transactions per day',
            },
            {
              key: 'core.avg_order_value',
              label: 'Average Order Value',
              cellType: 'INPUT',
              dataType: 'currency',
              defaultValue: 65,
              unit: '$',
              precision: 0,
              tooltip: 'Average revenue per transaction',
            },
            {
              key: 'core.operating_days_per_year',
              label: 'Operating Days Per Year',
              cellType: 'INPUT',
              dataType: 'number',
              defaultValue: 365,
              unit: 'days',
              precision: 0,
            },
            {
              key: 'core.annual_revenue',
              label: 'Gross Annual Revenue',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.daily_transactions * core.avg_order_value * core.operating_days_per_year',
              dependsOn: ['core.daily_transactions', 'core.avg_order_value', 'core.operating_days_per_year'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 2. CONSTANTS
    // -------------------------------------------------------
    {
      name: 'Constants',
      slug: 'constants',
      icon: 'lock',
      groups: [
        {
          label: 'Time & Calendar',
          cells: [
            { key: 'constants.hours_per_year', label: 'Hours Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 8760, unit: 'hrs', precision: 0 },
            { key: 'constants.weeks_per_year', label: 'Weeks Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 52, unit: 'weeks', precision: 0 },
            { key: 'constants.days_per_year', label: 'Days Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 365, unit: 'days', precision: 0 },
          ],
        },
        {
          label: 'Conversions',
          cells: [
            { key: 'constants.grams_per_lb', label: 'Grams Per Pound', cellType: 'CONSTANT', dataType: 'number', defaultValue: 453.592, unit: 'g', precision: 3 },
            { key: 'constants.oz_per_lb', label: 'Ounces Per Pound', cellType: 'CONSTANT', dataType: 'number', defaultValue: 16, unit: 'oz', precision: 0 },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 3. COGS
    // -------------------------------------------------------
    {
      name: 'COGS',
      slug: 'cogs',
      icon: 'package',
      groups: [
        {
          label: 'Product Cost',
          cells: [
            { key: 'cogs.avg_cogs_pct', label: 'Average COGS %', cellType: 'INPUT', dataType: 'percent', defaultValue: 50, unit: '%', precision: 1, tooltip: 'Average cost of goods sold as a percentage of revenue' },
            {
              key: 'cogs.annual_cogs',
              label: 'Annual COGS',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue * cogs.avg_cogs_pct / 100',
              dependsOn: ['core.annual_revenue', 'cogs.avg_cogs_pct'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 4. RETAIL OPERATIONS
    // -------------------------------------------------------
    {
      name: 'Retail Operations',
      slug: 'retail',
      icon: 'store',
      groups: [
        {
          label: 'POS & Tech',
          cells: [
            { key: 'retail.pos_monthly', label: 'POS System Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 500, unit: '$/mo', precision: 0 },
            { key: 'retail.security_tech_monthly', label: 'Security Tech Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 800, unit: '$/mo', precision: 0 },
            { key: 'retail.ecommerce_monthly', label: 'E-Commerce Platform Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 300, unit: '$/mo', precision: 0 },
            {
              key: 'retail.annual_tech_cost',
              label: 'Annual Tech Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(retail.pos_monthly + retail.security_tech_monthly + retail.ecommerce_monthly) * 12',
              dependsOn: ['retail.pos_monthly', 'retail.security_tech_monthly', 'retail.ecommerce_monthly'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Marketing',
          cells: [
            { key: 'retail.marketing_monthly', label: 'Marketing Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 3000, unit: '$/mo', precision: 0 },
            { key: 'retail.loyalty_program_monthly', label: 'Loyalty Program Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 500, unit: '$/mo', precision: 0 },
            {
              key: 'retail.annual_marketing_cost',
              label: 'Annual Marketing Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(retail.marketing_monthly + retail.loyalty_program_monthly) * 12',
              dependsOn: ['retail.marketing_monthly', 'retail.loyalty_program_monthly'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 5. LABOR
    // -------------------------------------------------------
    {
      name: 'Labor',
      slug: 'labor',
      icon: 'users',
      groups: [
        {
          label: 'Budtenders',
          cells: [
            { key: 'labor.budtender_count', label: 'Budtenders', cellType: 'INPUT', dataType: 'number', defaultValue: 8, unit: 'FTE', precision: 0 },
            { key: 'labor.budtender_hourly', label: 'Budtender Hourly Rate', cellType: 'INPUT', dataType: 'currency', defaultValue: 18, unit: '$/hr', precision: 2 },
            { key: 'labor.hours_week', label: 'Hours Per Week', cellType: 'INPUT', dataType: 'number', defaultValue: 32, unit: 'hrs/wk', precision: 0 },
            {
              key: 'labor.annual_budtender_cost',
              label: 'Annual Budtender Labor',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'labor.budtender_count * labor.budtender_hourly * labor.hours_week * constants.weeks_per_year',
              dependsOn: ['labor.budtender_count', 'labor.budtender_hourly', 'labor.hours_week', 'constants.weeks_per_year'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Management',
          cells: [
            { key: 'labor.manager_salary', label: 'Store Manager Salary', cellType: 'INPUT', dataType: 'currency', defaultValue: 65000, unit: '$/yr', precision: 0 },
            { key: 'labor.asst_manager_salary', label: 'Assistant Manager Salary', cellType: 'INPUT', dataType: 'currency', defaultValue: 50000, unit: '$/yr', precision: 0 },
            { key: 'labor.benefits_pct', label: 'Benefits Overhead', cellType: 'INPUT', dataType: 'percent', defaultValue: 25, unit: '%', precision: 0, tooltip: 'Added to all wages for benefits, taxes, insurance' },
            {
              key: 'labor.total_annual_labor',
              label: 'Total Annual Labor (with benefits)',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(labor.annual_budtender_cost + labor.manager_salary + labor.asst_manager_salary) * (1 + labor.benefits_pct / 100)',
              dependsOn: ['labor.annual_budtender_cost', 'labor.manager_salary', 'labor.asst_manager_salary', 'labor.benefits_pct'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 6. FACILITY & OVERHEAD
    // -------------------------------------------------------
    {
      name: 'Facility & Overhead',
      slug: 'facility',
      icon: 'building',
      groups: [
        {
          label: 'Rent & Insurance',
          cells: [
            { key: 'facility.rent_monthly', label: 'Rent/Mortgage Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 12000, unit: '$/mo', precision: 0 },
            { key: 'facility.insurance_monthly', label: 'Insurance Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 3000, unit: '$/mo', precision: 0 },
            { key: 'facility.security_monthly', label: 'Security Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 2500, unit: '$/mo', precision: 0 },
          ],
        },
        {
          label: 'Compliance & Licensing',
          cells: [
            { key: 'facility.license_annual', label: 'Annual License Fees', cellType: 'INPUT', dataType: 'currency', defaultValue: 15000, unit: '$/yr', precision: 0 },
            { key: 'facility.metrc_monthly', label: 'Metrc/Track-and-Trace Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 200, unit: '$/mo', precision: 0 },
            { key: 'facility.compliance_annual', label: 'Compliance Consulting', cellType: 'INPUT', dataType: 'currency', defaultValue: 5000, unit: '$/yr', precision: 0 },
          ],
        },
        {
          label: 'Totals',
          cells: [
            {
              key: 'facility.annual_total',
              label: 'Total Annual Facility Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(facility.rent_monthly + facility.insurance_monthly + facility.security_monthly + facility.metrc_monthly) * 12 + facility.license_annual + facility.compliance_annual',
              dependsOn: ['facility.rent_monthly', 'facility.insurance_monthly', 'facility.security_monthly', 'facility.metrc_monthly', 'facility.license_annual', 'facility.compliance_annual'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 7. UTILITIES
    // -------------------------------------------------------
    {
      name: 'Utilities',
      slug: 'utilities',
      icon: 'zap',
      groups: [
        {
          label: 'Monthly Utilities',
          cells: [
            { key: 'utilities.monthly_utilities', label: 'Monthly Utilities', cellType: 'INPUT', dataType: 'currency', defaultValue: 3500, unit: '$/mo', precision: 0 },
            {
              key: 'utilities.annual_utilities',
              label: 'Annual Utilities',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'utilities.monthly_utilities * 12',
              dependsOn: ['utilities.monthly_utilities'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 8. TAXES
    // -------------------------------------------------------
    {
      name: 'Taxes',
      slug: 'taxes',
      icon: 'receipt',
      groups: [
        {
          label: 'Retail Taxes',
          cells: [
            { key: 'taxes.excise_tax_pct', label: 'Excise Tax Rate', cellType: 'INPUT', dataType: 'percent', defaultValue: 15, unit: '%', precision: 1, tooltip: 'State excise tax on cannabis sales' },
            { key: 'taxes.local_tax_pct', label: 'Local/City Tax Rate', cellType: 'INPUT', dataType: 'percent', defaultValue: 5, unit: '%', precision: 1 },
            {
              key: 'taxes.annual_excise',
              label: 'Annual Excise Tax',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue * taxes.excise_tax_pct / 100',
              dependsOn: ['core.annual_revenue', 'taxes.excise_tax_pct'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'taxes.annual_local',
              label: 'Annual Local Tax',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue * taxes.local_tax_pct / 100',
              dependsOn: ['core.annual_revenue', 'taxes.local_tax_pct'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'taxes.total_annual_tax',
              label: 'Total Annual Tax Burden',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'taxes.annual_excise + taxes.annual_local',
              dependsOn: ['taxes.annual_excise', 'taxes.annual_local'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 9. P&L (KPI SECTION)
    // -------------------------------------------------------
    {
      name: 'Profit & Loss',
      slug: 'pnl',
      icon: 'trending-up',
      groups: [
        {
          label: 'Summary',
          cells: [
            {
              key: 'pnl.annual_revenue',
              label: 'Annual Revenue',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue',
              dependsOn: ['core.annual_revenue'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.total_annual_cost',
              label: 'Total Annual Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'cogs.annual_cogs + retail.annual_tech_cost + retail.annual_marketing_cost + labor.total_annual_labor + facility.annual_total + utilities.annual_utilities + taxes.total_annual_tax',
              dependsOn: [
                'cogs.annual_cogs',
                'retail.annual_tech_cost', 'retail.annual_marketing_cost',
                'labor.total_annual_labor', 'facility.annual_total', 'utilities.annual_utilities', 'taxes.total_annual_tax',
              ],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.cost_per_transaction',
              label: 'Cost Per Transaction',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.total_annual_cost / (core.daily_transactions * core.operating_days_per_year)',
              dependsOn: ['pnl.total_annual_cost', 'core.daily_transactions', 'core.operating_days_per_year'],
              unit: '$/txn',
              precision: 2,
            },
            {
              key: 'pnl.gross_profit',
              label: 'Gross Profit',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.annual_revenue - pnl.total_annual_cost',
              dependsOn: ['pnl.annual_revenue', 'pnl.total_annual_cost'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.gross_margin_pct',
              label: 'Gross Margin',
              cellType: 'COMPUTED',
              dataType: 'percent',
              formula: '(pnl.gross_profit / pnl.annual_revenue) * 100',
              dependsOn: ['pnl.gross_profit', 'pnl.annual_revenue'],
              unit: '%',
              precision: 1,
            },
            {
              key: 'pnl.taxable_profit',
              label: 'Taxable Profit (Pre-280E)',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.annual_revenue - (pnl.total_annual_cost - taxes.total_annual_tax)',
              dependsOn: ['pnl.annual_revenue', 'pnl.total_annual_cost', 'taxes.total_annual_tax'],
              unit: '$',
              precision: 0,
              tooltip: 'Revenue minus non-tax COGS. 280E limits deductions for cannabis businesses.',
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 10. INTER-COMPANY TRANSFERS
    // -------------------------------------------------------
    {
      name: 'Inter-Company Transfers',
      slug: 'transfers',
      icon: 'arrow-left-right',
      groups: [
        {
          label: 'Transfer Prices',
          cells: [
            {
              key: 'transfers.transfer_price_from_manufacturer',
              label: 'Transfer Price from Manufacturer',
              cellType: 'INPUT',
              dataType: 'currency',
              defaultValue: 0,
              unit: '$/unit',
              precision: 0,
              tooltip: 'Manual transfer price inputs for vertically integrated operations',
            },
          ],
        },
      ],
    },
  ],
};

// ============================================================
// TESTING LAB TEMPLATE
// ============================================================

export const TESTING_LAB_TEMPLATE: OpExTemplate = {
  name: 'Cannabis Testing Laboratory Operations',
  description: 'Cost model for cannabis analytical testing laboratory',
  kpiCells: [
    'pnl.annual_revenue',
    'pnl.total_annual_cost',
    'pnl.cost_per_test',
    'pnl.gross_margin_pct',
    'pnl.gross_profit',
    'pnl.taxable_profit',
  ],
  sections: [
    // -------------------------------------------------------
    // 1. CORE ASSUMPTIONS
    // -------------------------------------------------------
    {
      name: 'Core Assumptions',
      slug: 'core',
      icon: 'settings',
      groups: [
        {
          label: 'Revenue',
          cells: [
            {
              key: 'core.tests_per_day',
              label: 'Tests Per Day',
              cellType: 'INPUT',
              dataType: 'number',
              defaultValue: 25,
              unit: 'tests',
              precision: 0,
              tooltip: 'Average number of tests performed per operating day',
            },
            {
              key: 'core.avg_price_per_test',
              label: 'Average Price Per Test',
              cellType: 'INPUT',
              dataType: 'currency',
              defaultValue: 250,
              unit: '$/test',
              precision: 0,
              tooltip: 'Blended average price across all test types',
            },
            {
              key: 'core.operating_days_per_year',
              label: 'Operating Days Per Year',
              cellType: 'INPUT',
              dataType: 'number',
              defaultValue: 260,
              unit: 'days',
              precision: 0,
              tooltip: 'Typically 5 days/week x 52 weeks',
            },
            {
              key: 'core.annual_revenue',
              label: 'Gross Annual Revenue',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.tests_per_day * core.avg_price_per_test * core.operating_days_per_year',
              dependsOn: ['core.tests_per_day', 'core.avg_price_per_test', 'core.operating_days_per_year'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 2. CONSTANTS
    // -------------------------------------------------------
    {
      name: 'Constants',
      slug: 'constants',
      icon: 'lock',
      groups: [
        {
          label: 'Time & Calendar',
          cells: [
            { key: 'constants.hours_per_year', label: 'Hours Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 8760, unit: 'hrs', precision: 0 },
            { key: 'constants.weeks_per_year', label: 'Weeks Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 52, unit: 'weeks', precision: 0 },
            { key: 'constants.days_per_year', label: 'Days Per Year', cellType: 'CONSTANT', dataType: 'number', defaultValue: 365, unit: 'days', precision: 0 },
          ],
        },
        {
          label: 'Conversions',
          cells: [
            { key: 'constants.grams_per_lb', label: 'Grams Per Pound', cellType: 'CONSTANT', dataType: 'number', defaultValue: 453.592, unit: 'g', precision: 3 },
            { key: 'constants.oz_per_lb', label: 'Ounces Per Pound', cellType: 'CONSTANT', dataType: 'number', defaultValue: 16, unit: 'oz', precision: 0 },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 3. LAB EQUIPMENT
    // -------------------------------------------------------
    {
      name: 'Lab Equipment',
      slug: 'equipment',
      icon: 'microscope',
      groups: [
        {
          label: 'Capital',
          cells: [
            { key: 'equipment.annual_depreciation', label: 'Annual Equipment Depreciation', cellType: 'INPUT', dataType: 'currency', defaultValue: 75000, unit: '$/yr', precision: 0, tooltip: 'Annual depreciation on HPLC, GC-MS, ICP-MS, and other analytical equipment' },
            { key: 'equipment.calibration_annual', label: 'Annual Calibration & Service', cellType: 'INPUT', dataType: 'currency', defaultValue: 15000, unit: '$/yr', precision: 0 },
          ],
        },
        {
          label: 'Consumables',
          cells: [
            { key: 'equipment.reagents_monthly', label: 'Reagents Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 8000, unit: '$/mo', precision: 0 },
            { key: 'equipment.supplies_monthly', label: 'Lab Supplies Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 3000, unit: '$/mo', precision: 0 },
            {
              key: 'equipment.annual_consumables',
              label: 'Annual Consumables',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(equipment.reagents_monthly + equipment.supplies_monthly) * 12',
              dependsOn: ['equipment.reagents_monthly', 'equipment.supplies_monthly'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 4. LABOR
    // -------------------------------------------------------
    {
      name: 'Labor',
      slug: 'labor',
      icon: 'users',
      groups: [
        {
          label: 'Chemists',
          cells: [
            { key: 'labor.chemist_count', label: 'Chemists', cellType: 'INPUT', dataType: 'number', defaultValue: 3, unit: 'FTE', precision: 0 },
            { key: 'labor.chemist_hourly', label: 'Chemist Hourly Rate', cellType: 'INPUT', dataType: 'currency', defaultValue: 35, unit: '$/hr', precision: 2 },
            { key: 'labor.chemist_hours_week', label: 'Hours Per Week', cellType: 'INPUT', dataType: 'number', defaultValue: 40, unit: 'hrs/wk', precision: 0 },
            {
              key: 'labor.annual_chemist_cost',
              label: 'Annual Chemist Labor',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'labor.chemist_count * labor.chemist_hourly * labor.chemist_hours_week * constants.weeks_per_year',
              dependsOn: ['labor.chemist_count', 'labor.chemist_hourly', 'labor.chemist_hours_week', 'constants.weeks_per_year'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Lab Techs',
          cells: [
            { key: 'labor.tech_count', label: 'Lab Technicians', cellType: 'INPUT', dataType: 'number', defaultValue: 2, unit: 'FTE', precision: 0 },
            { key: 'labor.tech_hourly', label: 'Tech Hourly Rate', cellType: 'INPUT', dataType: 'currency', defaultValue: 22, unit: '$/hr', precision: 2 },
            { key: 'labor.tech_hours_week', label: 'Hours Per Week', cellType: 'INPUT', dataType: 'number', defaultValue: 40, unit: 'hrs/wk', precision: 0 },
            {
              key: 'labor.annual_tech_cost',
              label: 'Annual Tech Labor',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'labor.tech_count * labor.tech_hourly * labor.tech_hours_week * constants.weeks_per_year',
              dependsOn: ['labor.tech_count', 'labor.tech_hourly', 'labor.tech_hours_week', 'constants.weeks_per_year'],
              unit: '$',
              precision: 0,
            },
          ],
        },
        {
          label: 'Management',
          cells: [
            { key: 'labor.lab_director_salary', label: 'Lab Director Salary', cellType: 'INPUT', dataType: 'currency', defaultValue: 95000, unit: '$/yr', precision: 0 },
            { key: 'labor.benefits_pct', label: 'Benefits Overhead', cellType: 'INPUT', dataType: 'percent', defaultValue: 30, unit: '%', precision: 0, tooltip: 'Added to all wages for benefits, taxes, insurance' },
            {
              key: 'labor.total_annual_labor',
              label: 'Total Annual Labor (with benefits)',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(labor.annual_chemist_cost + labor.annual_tech_cost + labor.lab_director_salary) * (1 + labor.benefits_pct / 100)',
              dependsOn: ['labor.annual_chemist_cost', 'labor.annual_tech_cost', 'labor.lab_director_salary', 'labor.benefits_pct'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 5. FACILITY & OVERHEAD
    // -------------------------------------------------------
    {
      name: 'Facility & Overhead',
      slug: 'facility',
      icon: 'building',
      groups: [
        {
          label: 'Rent & Insurance',
          cells: [
            { key: 'facility.rent_monthly', label: 'Rent/Mortgage Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 10000, unit: '$/mo', precision: 0 },
            { key: 'facility.insurance_monthly', label: 'Liability Insurance Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 4000, unit: '$/mo', precision: 0, tooltip: 'Includes professional liability and general liability coverage' },
            { key: 'facility.security_monthly', label: 'Security Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 1000, unit: '$/mo', precision: 0 },
          ],
        },
        {
          label: 'Compliance & Licensing',
          cells: [
            { key: 'facility.license_annual', label: 'Annual License Fees', cellType: 'INPUT', dataType: 'currency', defaultValue: 15000, unit: '$/yr', precision: 0 },
            { key: 'facility.metrc_monthly', label: 'Metrc/Track-and-Trace Monthly', cellType: 'INPUT', dataType: 'currency', defaultValue: 200, unit: '$/mo', precision: 0 },
            { key: 'facility.compliance_annual', label: 'Compliance Consulting', cellType: 'INPUT', dataType: 'currency', defaultValue: 5000, unit: '$/yr', precision: 0 },
          ],
        },
        {
          label: 'Totals',
          cells: [
            {
              key: 'facility.annual_total',
              label: 'Total Annual Facility Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: '(facility.rent_monthly + facility.insurance_monthly + facility.security_monthly + facility.metrc_monthly) * 12 + facility.license_annual + facility.compliance_annual',
              dependsOn: ['facility.rent_monthly', 'facility.insurance_monthly', 'facility.security_monthly', 'facility.metrc_monthly', 'facility.license_annual', 'facility.compliance_annual'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 6. UTILITIES
    // -------------------------------------------------------
    {
      name: 'Utilities',
      slug: 'utilities',
      icon: 'zap',
      groups: [
        {
          label: 'Monthly Utilities',
          cells: [
            { key: 'utilities.monthly_utilities', label: 'Monthly Utilities', cellType: 'INPUT', dataType: 'currency', defaultValue: 4000, unit: '$/mo', precision: 0 },
            {
              key: 'utilities.annual_utilities',
              label: 'Annual Utilities',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'utilities.monthly_utilities * 12',
              dependsOn: ['utilities.monthly_utilities'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 7. ACCREDITATION & COMPLIANCE
    // -------------------------------------------------------
    {
      name: 'Accreditation & Compliance',
      slug: 'accreditation',
      icon: 'award',
      groups: [
        {
          label: 'Accreditation & Licensing',
          cells: [
            { key: 'accreditation.accreditation_annual', label: 'Annual Accreditation (ISO 17025)', cellType: 'INPUT', dataType: 'currency', defaultValue: 25000, unit: '$/yr', precision: 0, tooltip: 'ISO/IEC 17025 accreditation and maintenance fees' },
            { key: 'accreditation.proficiency_testing_annual', label: 'Proficiency Testing Annual', cellType: 'INPUT', dataType: 'currency', defaultValue: 5000, unit: '$/yr', precision: 0 },
            { key: 'accreditation.license_annual', label: 'Lab License Annual', cellType: 'INPUT', dataType: 'currency', defaultValue: 10000, unit: '$/yr', precision: 0 },
            {
              key: 'accreditation.total_annual_compliance',
              label: 'Total Annual Accreditation & Compliance',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'accreditation.accreditation_annual + accreditation.proficiency_testing_annual + accreditation.license_annual',
              dependsOn: ['accreditation.accreditation_annual', 'accreditation.proficiency_testing_annual', 'accreditation.license_annual'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 8. TAXES
    // -------------------------------------------------------
    {
      name: 'Taxes',
      slug: 'taxes',
      icon: 'receipt',
      groups: [
        {
          label: 'Business Taxes',
          cells: [
            { key: 'taxes.excise_tax_pct', label: 'Excise Tax Rate', cellType: 'INPUT', dataType: 'percent', defaultValue: 15, unit: '%', precision: 1, tooltip: 'State excise tax rate' },
            { key: 'taxes.local_tax_pct', label: 'Local/City Tax Rate', cellType: 'INPUT', dataType: 'percent', defaultValue: 5, unit: '%', precision: 1 },
            {
              key: 'taxes.annual_excise',
              label: 'Annual Excise Tax',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue * taxes.excise_tax_pct / 100',
              dependsOn: ['core.annual_revenue', 'taxes.excise_tax_pct'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'taxes.annual_local',
              label: 'Annual Local Tax',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue * taxes.local_tax_pct / 100',
              dependsOn: ['core.annual_revenue', 'taxes.local_tax_pct'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'taxes.total_annual_tax',
              label: 'Total Annual Tax Burden',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'taxes.annual_excise + taxes.annual_local',
              dependsOn: ['taxes.annual_excise', 'taxes.annual_local'],
              unit: '$',
              precision: 0,
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 9. P&L (KPI SECTION)
    // -------------------------------------------------------
    {
      name: 'Profit & Loss',
      slug: 'pnl',
      icon: 'trending-up',
      groups: [
        {
          label: 'Summary',
          cells: [
            {
              key: 'pnl.annual_revenue',
              label: 'Annual Revenue',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'core.annual_revenue',
              dependsOn: ['core.annual_revenue'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.total_annual_cost',
              label: 'Total Annual Cost',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'equipment.annual_depreciation + equipment.calibration_annual + equipment.annual_consumables + labor.total_annual_labor + facility.annual_total + utilities.annual_utilities + accreditation.total_annual_compliance + taxes.total_annual_tax',
              dependsOn: [
                'equipment.annual_depreciation', 'equipment.calibration_annual', 'equipment.annual_consumables',
                'labor.total_annual_labor', 'facility.annual_total', 'utilities.annual_utilities',
                'accreditation.total_annual_compliance', 'taxes.total_annual_tax',
              ],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.cost_per_test',
              label: 'Cost Per Test',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.total_annual_cost / (core.tests_per_day * core.operating_days_per_year)',
              dependsOn: ['pnl.total_annual_cost', 'core.tests_per_day', 'core.operating_days_per_year'],
              unit: '$/test',
              precision: 2,
            },
            {
              key: 'pnl.gross_profit',
              label: 'Gross Profit',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.annual_revenue - pnl.total_annual_cost',
              dependsOn: ['pnl.annual_revenue', 'pnl.total_annual_cost'],
              unit: '$',
              precision: 0,
            },
            {
              key: 'pnl.gross_margin_pct',
              label: 'Gross Margin',
              cellType: 'COMPUTED',
              dataType: 'percent',
              formula: '(pnl.gross_profit / pnl.annual_revenue) * 100',
              dependsOn: ['pnl.gross_profit', 'pnl.annual_revenue'],
              unit: '%',
              precision: 1,
            },
            {
              key: 'pnl.taxable_profit',
              label: 'Taxable Profit (Pre-280E)',
              cellType: 'COMPUTED',
              dataType: 'currency',
              formula: 'pnl.annual_revenue - (pnl.total_annual_cost - taxes.total_annual_tax)',
              dependsOn: ['pnl.annual_revenue', 'pnl.total_annual_cost', 'taxes.total_annual_tax'],
              unit: '$',
              precision: 0,
              tooltip: 'Revenue minus non-tax COGS. 280E limits deductions for cannabis businesses.',
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------
    // 10. INTER-COMPANY TRANSFERS
    // -------------------------------------------------------
    {
      name: 'Inter-Company Transfers',
      slug: 'transfers',
      icon: 'arrow-left-right',
      groups: [
        {
          label: 'Transfer Prices',
          cells: [
            {
              key: 'transfers.transfer_price_per_test',
              label: 'Transfer Price Per Test',
              cellType: 'INPUT',
              dataType: 'currency',
              defaultValue: 0,
              unit: '$/test',
              precision: 0,
              tooltip: 'Manual transfer price inputs for vertically integrated operations',
            },
          ],
        },
      ],
    },
  ],
};
