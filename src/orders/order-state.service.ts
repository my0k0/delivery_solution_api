import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { and, eq, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../common/database/database.service.js';
import { orderStatusHistory } from './order-status-history.schema.js';
import {
  orders,
  type AssigneeSnapshot,
  type OrderStatus,
} from './order.schema.js';

type OrderStateExecutor = Pick<
  typeof DatabaseService.prototype.db,
  'update' | 'insert'
>;

type OrderTransitionUpdates = Partial<
  Pick<
    typeof orders.$inferInsert,
    | 'assigneeType'
    | 'riderId'
    | 'partnerId'
    | 'deliveredAt'
    | 'cancelReason'
  >
>;

const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'CANCELLED'],
  AWAITING_APPROVAL: ['DELIVERED', 'ASSIGNED'],
  DELIVERED: [],
  CANCELLED: [],
};

export interface ApplyTransitionParameters {
  orderId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  changedBy: string;
  note?: string;
  reason?: string;
  internalNote?: string;
  previousAssignee?: AssigneeSnapshot | null;
  newAssignee?: AssigneeSnapshot | null;
  updates?: OrderTransitionUpdates;
}

@Injectable()
export class OrderStateService {
  constructor(private readonly database: DatabaseService) {}

  getAllowedTransitions(status: OrderStatus): readonly OrderStatus[] {
    return ALLOWED_TRANSITIONS[status];
  }

  /**
   * A status with no transition out of it has ended — `DELIVERED` and
   * `CANCELLED`. Derived from `ALLOWED_TRANSITIONS` rather than listed again, so
   * a status that becomes terminal is terminal everywhere, including the
   * order-edit guard below.
   */
  isTerminalStatus(status: OrderStatus): boolean {
    return ALLOWED_TRANSITIONS[status].length === 0;
  }

  async recordInitialStateInTransaction(
    transaction: OrderStateExecutor,
    parameters: {
      orderId: string;
      toStatus: OrderStatus;
      changedBy: string;
      newAssignee?: AssigneeSnapshot | null;
    },
  ): Promise<void> {
    await transaction.insert(orderStatusHistory).values({
      orderId: parameters.orderId,
      fromStatus: null,
      toStatus: parameters.toStatus,
      changedBy: parameters.changedBy,
      note: 'Order registered',
      previousAssignee: null,
      newAssignee: parameters.newAssignee ?? null,
    });
  }

  canTransition(fromStatus: OrderStatus, toStatus: OrderStatus): boolean {
    return this.getAllowedTransitions(fromStatus).includes(toStatus);
  }

  assertTransition(fromStatus: OrderStatus, toStatus: OrderStatus): void {
    if (!this.canTransition(fromStatus, toStatus)) {
      throw new BadRequestException(
        `Invalid order status transition: ${fromStatus} -> ${toStatus}`,
      );
    }
  }

  /**
   * Apply a permitted transition and append its history row atomically. The
   * update is guarded by the expected current status so concurrent writers
   * cannot double-apply a transition.
   */
  async applyTransition(parameters: ApplyTransitionParameters): Promise<void> {
    this.assertTransition(parameters.fromStatus, parameters.toStatus);
    await this.database.db.transaction(async (transaction) => {
      await this.applyTransitionInTransaction(transaction, parameters);
    });
  }

  async applyTransitionInTransaction(
    transaction: OrderStateExecutor,
    parameters: ApplyTransitionParameters,
  ): Promise<void> {
    this.assertTransition(parameters.fromStatus, parameters.toStatus);

    await this.transitionInTransaction(transaction, parameters);
  }

  async markPartnerDeliveredInTransaction(
    transaction: OrderStateExecutor,
    orderId: string,
    changedBy: string,
    deliveredAt: Date,
  ): Promise<void> {
    await this.transitionInTransaction(
      transaction,
      {
        orderId,
        fromStatus: 'ASSIGNED',
        toStatus: 'DELIVERED',
        changedBy,
        note: 'Partner order marked delivered by office',
        updates: { deliveredAt },
      },
      eq(orders.assigneeType, 'PARTNER'),
    );
  }

  async submitRiderDeliveredInTransaction(
    transaction: OrderStateExecutor,
    orderId: string,
    riderId: string,
    changedBy: string,
    deliveredAt: Date,
  ): Promise<void> {
    await this.transitionInTransaction(
      transaction,
      {
        orderId,
        fromStatus: 'ASSIGNED',
        toStatus: 'AWAITING_APPROVAL',
        changedBy,
        note: 'Rider submitted delivery for approval',
        updates: { deliveredAt },
      },
      and(eq(orders.assigneeType, 'RIDER'), eq(orders.riderId, riderId)),
    );
  }

  private async transitionInTransaction(
    transaction: OrderStateExecutor,
    parameters: ApplyTransitionParameters,
    additionalGuard?: SQL,
  ): Promise<void> {
    if (
      !(parameters.fromStatus === 'ASSIGNED' && parameters.toStatus === 'DELIVERED')
    ) {
      this.assertTransition(parameters.fromStatus, parameters.toStatus);
    }

    const updated = await transaction
      .update(orders)
      .set({
        ...parameters.updates,
        status: parameters.toStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, parameters.orderId),
          eq(orders.status, parameters.fromStatus),
          additionalGuard,
        ),
      )
      .returning({ id: orders.id });

    if (updated.length === 0) {
      throw new ConflictException(
        `Order '${parameters.orderId}' is not in status '${parameters.fromStatus}'`,
      );
    }

    await transaction.insert(orderStatusHistory).values({
      orderId: parameters.orderId,
      fromStatus: parameters.fromStatus,
      toStatus: parameters.toStatus,
      changedBy: parameters.changedBy,
      note: parameters.note ?? null,
      reason: parameters.reason ?? null,
      internalNote: parameters.internalNote ?? null,
      previousAssignee: parameters.previousAssignee ?? null,
      newAssignee: parameters.newAssignee ?? null,
    });
  }
}
