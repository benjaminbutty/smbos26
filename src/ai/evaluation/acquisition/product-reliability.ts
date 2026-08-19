import type { AcquisitionCategory } from "../../../core/acquisition/schemas";

export type AcquisitionProductReliabilityScenario = Readonly<{
  id: string;
  category: AcquisitionCategory;
  request: string;
}>;

/**
 * Engineering-only product-reliability corpus. These are deliberately
 * ordinary owner descriptions rather than synthetic schema instructions.
 * They are separate from the frozen eight-scenario hard contract.
 */
export const acquisitionProductReliabilityScenarios = Object.freeze([
  {
    id: "carpenter_jobs_quotes_workers",
    category: "jobs",
    request:
      "I’m a carpenter who needs to be able to track ongoing jobs, quotes handed to customers, which quotes need following up and which workers are working on which job",
  },
  {
    id: "electrician_work_orders",
    category: "jobs",
    request:
      "I run a small electrical business and want to keep customers, site visits, jobs, estimates and the parts still needed together.",
  },
  {
    id: "landscaper_projects",
    category: "jobs",
    request:
      "We design and maintain gardens and need a simple way to follow clients, garden projects, visits, quotations and the tasks for each project.",
  },
  {
    id: "milk_round_recurring_orders",
    category: "delivery",
    request:
      "I deliver milk locally and need to remember each customer's regular order, changes for the week and what has been delivered.",
  },
  {
    id: "farm_box_subscriptions",
    category: "delivery",
    request:
      "I run a small farm box round and want customers, the produce boxes they choose, recurring orders and delivery runs in one place.",
  },
  {
    id: "bakery_local_delivery",
    category: "delivery",
    request:
      "Our bakery takes weekly bread orders from households and cafes, and I need to organise products, quantities, customers and delivery rounds.",
  },
  {
    id: "dog_grooming_bookings",
    category: "appointments",
    request:
      "I run a dog grooming business and need customers, their pets, grooming appointments and the services booked kept organised.",
  },
  {
    id: "salon_client_bookings",
    category: "appointments",
    request:
      "I own a hair salon and want to keep clients, appointments, treatments and follow-up notes easy for the team to manage.",
  },
  {
    id: "massage_practice_sessions",
    category: "appointments",
    request:
      "I am a massage therapist and need a calm way to track clients, sessions, the treatment provided and when someone should return.",
  },
  {
    id: "tutoring_lessons",
    category: "appointments",
    request:
      "I tutor children after school and need pupils, parents, subjects, lessons and outstanding learning actions in one workspace.",
  },
  {
    id: "wedding_photography_enquiries",
    category: "enquiries",
    request:
      "I photograph weddings and want to keep enquiries, couples, event dates, package quotes and the next follow-up together.",
  },
  {
    id: "event_catering_enquiries",
    category: "enquiries",
    request:
      "My small catering company needs to manage new event enquiries, client details, menus discussed, proposals and follow-up dates.",
  },
  {
    id: "cleaning_service_jobs",
    category: "jobs",
    request:
      "I run a cleaning service and need to organise regular customers, properties, cleaning jobs, assigned cleaners and issues to check next time.",
  },
  {
    id: "property_maintenance_requests",
    category: "enquiries",
    request:
      "We handle property maintenance and need a place for landlord requests, properties, contractors, estimates and work still waiting to be done.",
  },
  {
    id: "equipment_hire",
    category: "jobs",
    request:
      "I hire out lighting and sound equipment and want to track customers, equipment, hire periods, quotes and whether everything has come back.",
  },
  {
    id: "party_supplier_orders",
    category: "delivery",
    request:
      "I supply party decorations and need to keep customers, products, event orders, collection details and delivery jobs organised.",
  },
  {
    id: "independent_retailer_stock",
    category: "products",
    request:
      "I have an independent gift shop and want a straightforward place to maintain products, suppliers, stock counts and customer orders.",
  },
  {
    id: "artisan_maker_orders",
    category: "products",
    request:
      "I make pottery to order and need customers, pieces, custom requests, prices and the work still to be finished kept together.",
  },
  {
    id: "bike_repair_workshop",
    category: "jobs",
    request:
      "My bicycle repair shop needs to track customers, bikes, repair jobs, parts required and when each bike is ready to collect.",
  },
  {
    id: "appliance_repair",
    category: "jobs",
    request:
      "I repair household appliances and need customers, appliances, repair visits, estimates and parts ordered linked to each job.",
  },
  {
    id: "mobile_mechanic",
    category: "jobs",
    request:
      "I am a mobile mechanic and want to keep vehicle owners, vehicles, jobs, inspections and the next action for each vehicle organised.",
  },
  {
    id: "plumber_service_calls",
    category: "jobs",
    request:
      "I run a plumbing business and need to follow customer requests, properties, service calls, quotes and engineers assigned to the work.",
  },
  {
    id: "b2b_marketing_consultancy",
    category: "enquiries",
    request:
      "My small marketing consultancy needs to manage company enquiries, contacts, opportunities, proposals and the follow-ups that move them forward.",
  },
  {
    id: "accountancy_client_work",
    category: "jobs",
    request:
      "I run a small accountancy practice and want clients, annual jobs, documents requested, deadlines and colleagues working on each job organised.",
  },
  {
    id: "small_hotel_operations",
    category: "appointments",
    request:
      "I manage a small hotel and need guests, rooms, reservations, housekeeping tasks and maintenance issues kept in one place.",
  },
  {
    id: "guesthouse_bookings",
    category: "appointments",
    request:
      "Our guesthouse needs a simple system for enquiries, guests, stays, rooms and the preparation tasks before each arrival.",
  },
  {
    id: "florist_event_orders",
    category: "delivery",
    request:
      "I run a florist and need customers, bouquets, event orders, delivery dates and the preparation work for each order organised.",
  },
  {
    id: "sports_coach_sessions",
    category: "appointments",
    request:
      "I coach a small sports club and need players, parents, training sessions, teams and actions for upcoming fixtures tracked.",
  },
  {
    id: "music_teacher_lessons",
    category: "appointments",
    request:
      "I teach music privately and want pupils, families, lessons, instruments and payment reminders kept easy to follow.",
  },
  {
    id: "wedding_venue_enquiries",
    category: "enquiries",
    request:
      "We run a wedding venue and need to manage couples, enquiries, viewing appointments, proposals and the next conversations.",
  },
  {
    id: "bespoke_furniture_maker",
    category: "jobs",
    request:
      "I make bespoke furniture and want customers, commissions, design decisions, quotes, materials and build stages connected.",
  },
] as const satisfies readonly AcquisitionProductReliabilityScenario[]);

export const ACQUISITION_PRODUCT_RELIABILITY_REPETITIONS = 3 as const;
