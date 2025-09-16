
"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Button } from '../ui/button';

// Define props for when the component is a link (<a> tag)
type LinkProps = {
  href: string;
  onClick?: never;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>;

// Define props for when the component is a clickable div
type DivProps = {
  href?: never;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
} & React.HTMLAttributes<HTMLDivElement>;


export interface DashboardItemProps {
  title: string;
  description: string;
  icon: React.ElementType;
  className?: string;
}

type PolymorphicDashboardItemProps = DashboardItemProps & (LinkProps | DivProps);

const DashboardItem = React.forwardRef<HTMLDivElement | HTMLAnchorElement, PolymorphicDashboardItemProps>(
  ({ title, description, icon: Icon, href, className, onClick, ...rest }, ref) => {
    
    const cardClasses = cn(
        "hover:shadow-lg hover:border-primary/50 transition-shadow,border-color duration-300 group flex flex-col h-full",
        { 'cursor-pointer': !!href || !!onClick },
        className
    );

    const cardContent = (
        <Card className={cardClasses}>
            <CardHeader>
                 <div className="flex justify-between items-start">
                    <Icon className="h-10 w-10 text-primary mb-4" />
                    <div className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="h-5 w-5" />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex-grow">
                <CardTitle className="text-xl font-headline mb-2">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardContent>
        </Card>
    );

    if (href) {
      return (
        <Link href={href} passHref legacyBehavior>
          <a ref={ref as React.Ref<HTMLAnchorElement>} {...(rest as React.HTMLAttributes<HTMLAnchorElement>)}>
             {cardContent}
          </a>
        </Link>
      );
    }
    
    return (
      <div ref={ref as React.Ref<HTMLDivElement>} onClick={onClick} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>
        {cardContent}
      </div>
    );
  }
);

DashboardItem.displayName = 'DashboardItem';

export default DashboardItem;
